import { afterEach, describe, expect, it, vi } from 'vitest'
import { Store, canonical, hash } from '../packages/database'
import { AuthService } from '../apps/web/server/services/auth'
import { ContentService, checkAssets } from '../apps/web/server/services/content'
import { GameService } from '../apps/web/server/services/game'
import { ArchiveService } from '../apps/web/server/services/archive'
import { SaveArchiveSchema, validateArchiveRelations, type SaveArchive } from '../packages/contracts/archive'
import { demoPack } from '../packages/content/seed'
import { legacyPack } from '../packages/content/seed-v1'

// Archive relational/replay tests are independent of whether an image-generation tool ran on CI.
// The separate missing-resource test verifies that the actual publication gate is consulted.
vi.mock('../apps/web/server/services/content', async importOriginal => ({ ...await importOriginal<typeof import('../apps/web/server/services/content')>(), checkAssets: vi.fn(() => ({ ok: true, errors: [] })) }))
const stores: Store[] = []
function setup() {
  const store = new Store(':memory:'); stores.push(store)
  const content = new ContentService(store); content.seed(); store.run("UPDATE packs SET status='published',active=0"); store.run('UPDATE packs SET active=1 WHERE id=? AND version=?', demoPack.id, String(demoPack.version))
  const auth = new AuthService(store); const guest = auth.guest(); const game = new GameService(store); const session = game.create(guest.user.id, { packId: demoPack.id, seed: 'archive-seed' })
  return { store, auth, game, userId: guest.user.id, session, importer: new ArchiveService(store) }
}
const resign = (archive: SaveArchive) => { const { checksum: _, ...body } = archive; return { ...body, checksum: hash(canonical(body)) } }
afterEach(() => { stores.splice(0).forEach(store => store.close()); vi.mocked(checkAssets).mockReturnValue({ ok: true, errors: [] }) })

describe('受约束存档导入', () => {
  it('导出1.1通过严格schema与关系校验', () => {
    const { auth, userId } = setup(); const archive = SaveArchiveSchema.parse(auth.export(userId))
    expect(validateArchiveRelations(archive)).toEqual([])
  })
  it('当前身份获得独立副本，实际私聊/手账/分支/映射保留但全部对象ID重建', async () => {
    const { auth, userId, game, session, importer, store } = setup()
    const result = await game.act(userId, session.id, { clientActionId: crypto.randomUUID(), expectedRevision: 0, branchId: session.branchId, kind: 'message', text: '只给周砚的私人问题', channel: 'private', recipientId: 'zhou' })
    game.journal(userId, session.id, session.branchId, '私人手账原文')
    game.fork(userId, session.id, { branchId: session.branchId, eventSeq: 1 })
    const archive = auth.export(userId); const other = auth.guest(); const restored = importer.import(other.user.id, archive)
    expect(restored.importedSessions).toBe(1)
    expect(restored.sessionIds[0]).not.toBe(session.id)
    const copy = game.get(other.user.id, restored.sessionIds[0]!)
    expect(copy.branches).toHaveLength(2)
    const root = copy.branches.find(branch => !branch.parentBranchId)!
    const rootCopy = game.get(other.user.id, copy.id, root.id)
    expect(rootCopy.state).toEqual(result.session.state)
    expect(rootCopy.messages.map(message => message.text)).toEqual(result.session.messages.map(message => message.text))
    expect(rootCopy.messages.at(-1)?.recipientId).toBe('zhou')
    expect(game.journal(other.user.id, copy.id, root.id).text).toBe('私人手账原文')
    expect(rootCopy.instance.slotMapping).toEqual(session.instance.slotMapping)
    expect(rootCopy.messages[0]!.id).not.toBe(session.messages[0]!.id)
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM user_roles WHERE user_id=?', other.user.id)!.n).toBe(0)
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM action_receipts WHERE session_id=?', copy.id)!.n).toBe(0)
    expect(importer.import(other.user.id, archive)).toMatchObject({ sessionIds: restored.sessionIds, replayed: true })
    const next = await game.act(other.user.id, copy.id, { clientActionId: crypto.randomUUID(), expectedRevision: copy.revision, branchId: copy.branchId, kind: 'choice', choiceId: copy.choices[0]!.id, channel: 'group' })
    expect(next.session.revision).toBe(1)
  })
  it('未知schema、权限字段、错误哈希、冻结包变更均拒绝且不写入', () => {
    const { auth, userId, importer, store } = setup(); const archive = SaveArchiveSchema.parse(auth.export(userId)); const before = store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions')!.n
    expect(() => importer.import(userId, { ...archive, roles: ['admin'] })).toThrow()
    expect(() => importer.import(userId, { ...archive, schemaVersion: '99' })).toThrow()
    expect(() => importer.import(userId, { ...archive, checksum: '0'.repeat(64) })).toThrow('校验和')
    archive.packageRefs[0]!.checksum = '0'.repeat(64)
    expect(() => importer.import(userId, resign(archive))).toThrow('冻结内容版本')
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions')!.n).toBe(before)
  })
  it('重新计算哈希也不能伪造世界效果、未来消息来源或跨会话引用', async () => {
    const { auth, userId, importer, game, session } = setup()
    await game.act(userId, session.id, { clientActionId: crypto.randomUUID(), expectedRevision: 0, branchId: session.branchId, kind: 'choice', choiceId: session.choices[0]!.id, channel: 'group' })
    const archive = SaveArchiveSchema.parse(auth.export(userId)); const state = JSON.parse(archive.events[1]!.state_after) as { flags: { verified: boolean } }; state.flags.verified = true; archive.events[1]!.state_after = JSON.stringify(state)
    expect(() => importer.import(userId, resign(archive))).toThrow('无法由保存的实际行动复现')
    const cross = SaveArchiveSchema.parse(auth.export(userId)); cross.branches[0]!.session_id = 'unknown-session'
    expect(() => importer.import(userId, resign(cross))).toThrow('会话')
    const cycle = SaveArchiveSchema.parse(auth.export(userId)); cycle.branches[0]!.parent_branch_id = cycle.branches[0]!.id
    expect(() => importer.import(userId, resign(cycle))).toThrow('循环')
  })
  it('文件超限和旧资源不可用时拒绝，保留原文件而非套用新版本', () => {
    const { auth, userId, importer } = setup(); const archive = auth.export(userId)
    expect(() => importer.import(userId, { ...archive, text: '大'.repeat(180000) })).toThrow('512 KB')
    vi.mocked(checkAssets).mockReturnValue({ ok: false, errors: ['missing fixed version'] })
    expect(() => importer.import(userId, archive)).toThrow('冻结资源版本不可用')
  })
  it('认领游客后保留旧行为者日志，导入仍只授权当前请求身份', () => {
    const { auth, userId, importer, store } = setup(); const target = auth.guest()
    // Guest claiming changes session ownership while immutable historic event actors keep the old identifier.
    store.run('UPDATE sessions SET owner_id=? WHERE owner_id=?', target.user.id, userId)
    const archive = auth.export(target.user.id)
    expect(() => importer.import(target.user.id, archive)).not.toThrow()
  })
  it('安全包回退和其分支能导出恢复，不能伪造回退目标或实例标记', () => {
    const { auth, userId, importer, store, game, session } = setup()
    store.run('DELETE FROM sessions WHERE id=?', session.id)
    const broken = structuredClone(demoPack)
    broken.events = broken.events.map(event => event.slot === 'ending' ? { ...event, slot: 'work' } : event)
    store.run('UPDATE packs SET manifest=?,checksum=? WHERE id=? AND version=?', JSON.stringify(broken), hash(canonical(broken)), broken.id, String(broken.version))
    const fallback = game.create(userId, { packId: demoPack.id, seed: 'requested-but-incompatible' })
    expect(fallback.packVersion).toBe(legacyPack.version)
    expect(fallback.instance.fallback).toBe(true)
    game.fork(userId, fallback.id, { branchId: fallback.branchId, eventSeq: 1 })
    const archive = SaveArchiveSchema.parse(auth.export(userId))
    const restored = importer.import(userId, archive)
    const copy = game.get(userId, restored.sessionIds[0]!)
    expect(copy.instance).toMatchObject({ fallback: true, seed: 'fixed-safe-v1', packVersion: legacyPack.version })
    expect(copy.branches).toHaveLength(2)
    expect(copy.assemblyFallback).toEqual(fallback.assemblyFallback)
    const forged = structuredClone(archive)
    const payload = JSON.parse(forged.events[0]!.payload) as { assemblyFallback: { toPackVersion: number } }
    payload.assemblyFallback.toPackVersion = demoPack.version
    forged.events[0]!.payload = JSON.stringify(payload)
    expect(() => importer.import(userId, resign(forged))).toThrow('固定安全包')
  })
})
