import { randomBytes, timingSafeEqual } from 'node:crypto'
import { argon2id, hash as passwordHash, verify } from 'argon2'
import { z } from 'zod'
import type { Store} from '../../../../packages/database';
import { id, now, hash, invariant,canonical } from '../../../../packages/database'
import { users } from '../../../../packages/database/schema'

export const credentialsSchema = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, '用户名需为 3–32 位英文、数字或下划线'), password: z.string().min(12, '密码至少 12 位').max(128), claimGuest: z.boolean().optional() }).strict()
export type User = { id: string; username: string | null; isGuest: boolean; roles: string[] }
type UserRow = { id: string; username: string | null; is_guest: number; password_hash: string | null }
export type Identity = { user: User; tokenHash: string; csrfToken: string }
const token = () => randomBytes(32).toString('base64url')
const hashing = { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const
export class AuthService {
  constructor(readonly store: Store) {}
  user(row: UserRow): User { return { id: row.id, username: row.username, isGuest: Boolean(row.is_guest), roles: this.store.all<{ role: string }>('SELECT role FROM user_roles WHERE user_id=?', row.id).map(r => r.role) } }
  lookup(raw: string | undefined): Identity | null {
    if (!raw || raw.length > 100) return null
    const tokenHash = hash(raw)
    const session = this.store.get<{ user_id: string; csrf_token: string }>('SELECT user_id,csrf_token FROM auth_sessions WHERE token_hash=? AND expires_at>?', tokenHash, Date.now())
    if (!session) return null
    const row = this.store.get<UserRow>('SELECT * FROM users WHERE id=?', session.user_id)
    return row ? { user: this.user(row), tokenHash, csrfToken: session.csrf_token } : null
  }
  issue(userId: string, old?: Identity | null) {
    const raw = token(), csrfToken = token()
    this.store.transaction(() => {
      if (old) this.store.run('DELETE FROM auth_sessions WHERE token_hash=?', old.tokenHash)
      this.store.run('INSERT INTO auth_sessions VALUES (?,?,?,?,?)', hash(raw), userId, csrfToken, Date.now() + 30 * 86400000, now())
    })
    const row = this.store.get<UserRow>('SELECT * FROM users WHERE id=?', userId)!
    return { raw, user: this.user(row), csrfToken }
  }
  guest(existing?: Identity | null) {
    if (existing) return { user: existing.user, csrfToken: existing.csrfToken }
    const userId = id()
    this.store.db.insert(users).values({ id: userId, username: null, passwordHash: null, isGuest: true, createdAt: now() }).run()
    return this.issue(userId)
  }
  rateLimit(key: string, limit = 8) {
    const keyHash = hash(key), timestamp = Date.now()
    this.store.transaction(() => {
      const row = this.store.get<{ attempts: number; window_until: number }>('SELECT * FROM auth_attempts WHERE key_hash=?', keyHash)
      invariant(!row || row.window_until < timestamp || row.attempts < limit, 'RATE_LIMIT', 429, '尝试过于频繁，请 15 分钟后重试。')
      this.store.run('INSERT INTO auth_attempts VALUES (?,?,?) ON CONFLICT(key_hash) DO UPDATE SET attempts=excluded.attempts,window_until=excluded.window_until', keyHash, row && row.window_until > timestamp ? row.attempts + 1 : 1, row && row.window_until > timestamp ? row.window_until : timestamp + 900000)
    })
  }
  async register(input: unknown, existing: Identity | null) {
    const body = credentialsSchema.extend({ claimGuest: z.boolean() }).parse(input)
    invariant(!existing || existing.user.isGuest, 'ALREADY_REGISTERED', 409, '请先退出当前正式账号。')
    invariant(!this.store.get('SELECT id FROM users WHERE username=?', body.username), 'USERNAME_TAKEN', 409, '用户名已被使用。')
    const encoded = await passwordHash(body.password, hashing)
    const userId = body.claimGuest && existing?.user.isGuest ? existing.user.id : id()
    const recoveryCodes = Array.from({ length: 6 }, () => randomBytes(12).toString('hex').match(/.{1,6}/g)!.join('-'))
    this.store.transaction(() => {
      invariant(!this.store.get('SELECT id FROM users WHERE username=?', body.username), 'USERNAME_TAKEN', 409, '用户名已被使用。')
      if (userId === existing?.user.id) this.store.run('UPDATE users SET username=?,password_hash=?,is_guest=0 WHERE id=? AND is_guest=1', body.username, encoded, userId)
      else this.store.run('INSERT INTO users VALUES (?,?,?,?,?)', userId, body.username, encoded, 0, now())
      for (const code of recoveryCodes) this.store.run('INSERT INTO recovery_codes VALUES (?,?,NULL)', userId, hash(code))
      this.store.audit(userId, 'account.register', userId, { guestClaimed: userId === existing?.user.id })
    })
    return { ...this.issue(userId, existing), recoveryCodes }
  }
  async login(input: unknown, existing: Identity | null) {
    const body = credentialsSchema.parse(input)
    this.rateLimit(`login:${body.username}`)
    const row = this.store.get<UserRow>('SELECT * FROM users WHERE username=? AND is_guest=0', body.username)
    // Equal-cost fallback avoids immediate unknown-user responses.
    const fallback = '$argon2id$v=19$m=19456,t=2,p=1$aW52YWxpZHVzZXJzYWx0MDEyMzQ$6XmUgjXOJXpkhfjnurV59YsYnPQgtCsYRUTGnNlAR5E'
    let valid: boolean
    try { valid = await verify(row?.password_hash || fallback, body.password) } catch { valid = false }
    invariant(row && valid, 'INVALID_CREDENTIALS', 401, '用户名或密码不正确。')
    if (body.claimGuest && existing?.user.isGuest) this.store.transaction(() => {
      this.store.run('UPDATE sessions SET owner_id=? WHERE owner_id=?', row.id, existing.user.id)
      this.store.run('UPDATE feedback SET owner_id=? WHERE owner_id=?', row.id, existing.user.id)
      this.store.run('DELETE FROM users WHERE id=? AND is_guest=1', existing.user.id)
      this.store.audit(row.id, 'account.claim_guest', row.id)
    })
    return this.issue(row.id, existing)
  }
  async recover(input: unknown) {
    const body = z.object({ username: z.string().trim().toLowerCase().max(32), recoveryCode: z.string().min(12).max(80), newPassword: z.string().min(12).max(128) }).strict().parse(input)
    this.rateLimit(`recover:${body.username}`, 5)
    const row = this.store.get<UserRow>('SELECT * FROM users WHERE username=? AND is_guest=0', body.username)
    const codeHash = hash(body.recoveryCode.trim().toLowerCase())
    invariant(row && this.store.get('SELECT code_hash FROM recovery_codes WHERE user_id=? AND code_hash=? AND used_at IS NULL', row.id, codeHash), 'INVALID_RECOVERY', 401, '用户名或恢复码不正确。')
    const encoded = await passwordHash(body.newPassword, hashing)
    this.store.transaction(() => {
      const changed = this.store.run('UPDATE recovery_codes SET used_at=? WHERE user_id=? AND code_hash=? AND used_at IS NULL', now(), row.id, codeHash).changes
      invariant(changed === 1, 'INVALID_RECOVERY', 401, '该恢复码已使用。')
      this.store.run('UPDATE users SET password_hash=? WHERE id=?', encoded, row.id)
      this.store.run('DELETE FROM auth_sessions WHERE user_id=?', row.id)
      this.store.audit(row.id, 'account.recover', row.id)
    })
    return this.issue(row.id)
  }
  requireRole(identity: Identity, allowed: string[]) { invariant(identity.user.roles.some(r => allowed.includes(r)), 'FORBIDDEN', 403, '当前账号没有这项内容操作权限。') }
  csrf(identity: Identity, value: string | undefined) { invariant(value && value.length === identity.csrfToken.length && timingSafeEqual(Buffer.from(value), Buffer.from(identity.csrfToken)), 'CSRF_REJECTED', 403, '页面凭据已更新，请刷新后重试。') }
  logout(identity: Identity) { this.store.run('DELETE FROM auth_sessions WHERE token_hash=?', identity.tokenHash) }
  export(userId: string, sessionId?: string) {
    const sessions = this.store.all<{ id: string; mode: 'story' | 'galgame'; pack_id: string; pack_version: string }>(sessionId ? 'SELECT * FROM sessions WHERE owner_id=? AND id=?' : 'SELECT * FROM sessions WHERE owner_id=?', ...sessionId ? [userId, sessionId] : [userId])
    invariant(!sessionId || sessions.length === 1, 'SESSION_NOT_FOUND', 404, '存档不存在或不属于当前账号。')
    const related = (table: string) => sessions.flatMap(s => this.store.all(`SELECT * FROM ${table} WHERE session_id=?`, s.id))
    this.store.audit(userId, 'account.export', userId)
    const seen = new Set<string>()
    const packageRefs = sessions.flatMap(session => {
      const key = `${session.pack_id}:${session.pack_version}`
      if (seen.has(key)) return []; seen.add(key)
      const row = this.store.get<{ id: string; version: string; checksum: string; assetManifestVersion: string }>('SELECT id,version,checksum,asset_manifest_version AS assetManifestVersion FROM packs WHERE id=? AND version=?', session.pack_id, session.pack_version)!
      return [{ ...row, version: Number(row.version) }]
    })
    const mixed = sessions.some(session => session.mode === 'galgame')
    const archive = { schemaVersion: mixed ? '1.2' : '1.1', exportedAt: now(), owner: this.store.get('SELECT id,username,is_guest,created_at FROM users WHERE id=?', userId), packageRefs,
      sessions: mixed ? sessions : sessions.map(({ mode: _mode, ...session }) => session), branches: related('branches'), instances: related('game_instances'), events: related('event_logs'), snapshots: related('snapshots'), journals: related('journals'),
      feedback: sessionId ? this.store.all('SELECT * FROM feedback WHERE owner_id=? AND session_id=?', userId, sessionId) : this.store.all('SELECT * FROM feedback WHERE owner_id=?', userId), ...(mixed ? { galgameInstances: related('galgame_instances') } : {}) }
    invariant(Buffer.byteLength(JSON.stringify(archive), 'utf8') < 15 * 1024 * 1024, 'ARCHIVE_TOO_LARGE', 413, '归档过大，请从我的旅程按局导出。')
    return { ...archive, checksum: hash(canonical(archive)) }
  }
  delete(userId: string) {
    this.store.transaction(() => {
      this.store.run('INSERT OR IGNORE INTO account_deletions VALUES (?,?)', hash(userId), now())
      this.store.run("UPDATE audit_logs SET actor_id=NULL,resource_id='deleted',metadata='{}' WHERE actor_id=? OR resource_id=?", userId,userId)
      this.store.run("UPDATE reviews SET reviewer='deleted' WHERE reviewer=?",userId)
      this.store.run('DELETE FROM users WHERE id=?', userId)
      this.store.audit(null, 'account.deleted', 'deleted', { retention: 'encrypted backups expire within 30 days; restore requires erasure replay' })
    })
  }
}
