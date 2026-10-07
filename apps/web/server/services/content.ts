import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { Store} from '../../../../packages/database';
import { canonical, hash, id, invariant, now } from '../../../../packages/database'
import { ContentPackSchema, type ContentPack } from '../../../../packages/contracts'
import { demoPack } from '../../../../packages/content/seed'
import {legacyPack} from '../../../../packages/content/seed-v1'
import { validatePack,assemble } from '../../../../packages/narrative/engine'
import type { Identity } from './auth'
import { AuthService } from './auth'
import { createHash } from 'node:crypto'

export function projectRoot() {
  const cwd = process.cwd()
  if(existsSync(resolve(cwd,'packages/database')))return cwd
  const parent=resolve(cwd,'../..')
  return existsSync(resolve(parent,'packages/database'))?parent:cwd
}
const AssetFileSchema=z.object({id:z.string(),file:z.string().regex(/^\/art\/[a-zA-Z0-9_.-]+\.webp$/),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive().max(8_000_000),width:z.number().int().positive().max(4096),height:z.number().int().positive().max(4096),alpha:z.boolean()})
const AssetSchema = AssetFileSchema.extend({type: z.enum(['character', 'avatar', 'background']), reviewStatus: z.literal('agent-reviewed'), rights: z.object({ licenseRecordId: z.string().min(1), redistributionApproved: z.literal(true) }),variants:z.union([z.array(AssetFileSchema).max(4),z.object({retina:AssetFileSchema.optional(),mobile:AssetFileSchema.optional()}).strict()]).optional() })
export function checkAssets(pack: ContentPack, root = projectRoot()): { ok: boolean; errors: string[] } {
  try {
    invariant(/^[a-zA-Z0-9_.-]{1,80}$/.test(pack.assetManifestVersion),'INVALID_ASSET_VERSION',400,'资源版本名称无效。')
    const fixedManifestName=`art/manifest-${pack.assetManifestVersion}.json`
    const candidates=process.env.ASSET_PUBLIC_DIR?[resolve(process.env.ASSET_PUBLIC_DIR)]:[resolve(root,'apps/web/public'),resolve(root,'public'),resolve(root,'../public')]
    const publicRoot=candidates.find(path=>existsSync(resolve(path,fixedManifestName))||existsSync(resolve(path,'art/manifest.json'))) || candidates[0]!
    const manifestPath=existsSync(resolve(publicRoot,fixedManifestName))?resolve(publicRoot,fixedManifestName):resolve(publicRoot,'art/manifest.json')
    const manifest = z.object({ version: z.string(), status: z.literal('published'), assets: z.array(AssetSchema) }).parse(JSON.parse(readFileSync(manifestPath, 'utf8')))
    const errors: string[] = []
    if (manifest.version !== pack.assetManifestVersion) errors.push('资源清单版本不匹配')
    const ids = new Set<string>()
    for (const asset of manifest.assets) {
      if (ids.has(asset.id)) errors.push(`资源ID重复:${asset.id}`)
      ids.add(asset.id)
      const variants=Array.isArray(asset.variants)?asset.variants:Object.values(asset.variants||{}).filter((v):v is z.infer<typeof AssetFileSchema>=>Boolean(v))
      if(pack.assetManifestVersion!=='careerscape-art-v1'&&asset.type==='background'&&(Array.isArray(asset.variants)||!asset.variants?.mobile))errors.push(`独立竖构图缺失:${asset.id}`)
      for(const file of [asset,...variants]){
        const path = resolve(publicRoot, `.${file.file}`)
        const bytes = readFileSync(path)
        if (bytes.length !== file.bytes) errors.push(`资源体积不匹配:${file.id}`)
        // Hash every actual dependency, including mobile and retina variants.
        if (createByteHash(bytes) !== file.sha256) errors.push(`资源哈希不匹配:${file.id}`)
      }
    }
    for (const ref of pack.assetRefs) if (!ids.has(ref)) errors.push(`资源未登记:${ref}`)
    if (manifest.assets.filter(a => a.type === 'character').length < 12 || manifest.assets.filter(a => a.type === 'avatar').length < 3 || manifest.assets.filter(a => a.type === 'background').length < 4) errors.push('美术数量未达到12立绘、3头像、4背景')
    return { ok: !errors.length, errors }
  } catch (error) { return { ok: false, errors: [`资源清单缺失或未通过发布校验:${error instanceof Error ? error.message.slice(0, 160) : 'invalid manifest'}`] } }
}
function createByteHash(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex') }
type PackRow = { id: string; version: string; status: string; active: number; manifest: string; domain_review_status: string }
function checkPublishAssembly(pack:ContentPack){
  const candidate=ContentPackSchema.parse({...pack,contentStatus:'published',events:pack.events.map(event=>({...event,contentStatus:'published'}))})
  try{for(const seed of ['publish-0','publish-1','publish-2','publish-3','publish-4'])assemble(candidate,seed)}
  catch(error){invariant(false,'ASSEMBLY_GATE',409,`内容无法形成完整可玩组合：${error instanceof Error?error.message.slice(0,250):'组合校验失败'}`)}
}
export class ContentService {
  constructor(readonly store: Store) {}
  seed() {
    const pack = ContentPackSchema.parse(demoPack)
    const validation = validatePack(pack)
    invariant(validation.valid, 'INVALID_SEED', 500, validation.issues.join('；'))
    const gate = checkAssets(pack)
    this.store.transaction(() => {
      this.store.run('INSERT OR IGNORE INTO occupation_profiles VALUES (?,?,?,?)', pack.profile.id, String(pack.profileVersion), JSON.stringify(pack.profile), 'published')
      for (const source of pack.sources) this.store.run('INSERT OR IGNORE INTO sources VALUES (?,?,?,?,?)', source.id, source.url, JSON.stringify(source.rights), source.observedAt, JSON.stringify(source))
      for (const fact of pack.facts) this.store.run('INSERT OR IGNORE INTO facts VALUES (?,?,?,?,?,?)', fact.id, fact.sourceId, 'original synthetic fixture', JSON.stringify(fact), 'fictional', 'agent_checked')
      const addTemplate = (templateId: string, type: string, payload: unknown, factIds: string[]) => this.store.run('INSERT OR IGNORE INTO templates VALUES (?,?,?,?,?,?,?,?,?,?,NULL)', templateId, String(pack.version), type, pack.profile.id, String(pack.profileVersion), JSON.stringify(factIds), JSON.stringify(payload), hash(canonical(payload)), 'approved', 'pending')
      for (const c of pack.characters) addTemplate(c.id, 'character', c, c.sourceFactIds)
      addTemplate(pack.project.id, 'project', pack.project, [])
      for (const e of pack.events) addTemplate(e.id, 'event', e, e.sourceFactIds)
      const existing = this.store.get<PackRow>('SELECT * FROM packs WHERE id=? AND version=?', pack.id, String(pack.version))
      if (!existing) {
        const canInitialize=gate.ok&&!this.store.get('SELECT id FROM packs WHERE id=? AND active=1',pack.id)
        this.insert(pack,canInitialize?'published':'approved',canInitialize)
        this.store.audit(null, canInitialize?'seed.demo_published':gate.ok?'seed.awaiting_activation':'seed.awaiting_assets', `${pack.id}@${pack.version}`, { reviewerType: 'agent', domainReviewStatus: 'pending', errors: gate.errors })
      } else if (gate.ok && existing.status === 'approved' && !this.store.get('SELECT id FROM packs WHERE id=? AND active=1',pack.id)) {
        this.store.run('UPDATE packs SET active=0 WHERE id=?', pack.id)
        this.store.run('UPDATE packs SET status=?,active=1 WHERE id=? AND version=?', 'published', pack.id, String(pack.version))
        this.store.audit(null, 'seed.demo_published', `${pack.id}@${pack.version}`, { reviewerType: 'agent', domainReviewStatus: 'pending' })
      }
      if (gate.ok) this.store.run("UPDATE templates SET content_status='published' WHERE profile_id=? AND version=?", pack.profile.id, String(pack.version))
      if(legacyPack.version!==pack.version&&!this.store.get('SELECT id FROM packs WHERE id=? AND version=?',legacyPack.id,String(legacyPack.version))){
        const legacy=ContentPackSchema.parse(legacyPack),legacyAssets=checkAssets(legacy)
        if(legacyAssets.ok){
          this.insert(legacy,'published',false)
          this.store.audit(null,'seed.legacy_retained',`${legacy.id}@${legacy.version}`,{active:false,purpose:'frozen saves and import',reviewerType:'agent'})
        }
      }
    })
    const stored=this.store.get<PackRow>('SELECT * FROM packs WHERE id=? AND version=?',pack.id,String(pack.version))!
    return { packId: pack.id, version: pack.version,status:stored.status,active:Boolean(stored.active),assetGate: gate }
  }
  insert(pack: ContentPack, status: string, active = false) {
    this.store.run('INSERT INTO packs VALUES (?,?,?,?,?,?,?,?,?,?,?)', pack.id, String(pack.version), pack.datasetVersion, pack.contentBuildId, pack.assetManifestVersion, JSON.stringify(pack), hash(canonical(pack)), status, pack.domainReviewStatus, active ? 1 : 0, now())
  }
  get(packId: string, version?: number | string): ContentPack {
    const row = version === undefined ? this.store.get<PackRow>("SELECT * FROM packs WHERE id=? AND active=1 AND status='published'", packId) : this.store.get<PackRow>('SELECT * FROM packs WHERE id=? AND version=?', packId, String(version))
    invariant(row, 'PACK_UNAVAILABLE', 409, '该职业包尚未发布或暂时不可用。')
    const pack = ContentPackSchema.parse(JSON.parse(row.manifest))
    // SQL publication state is authoritative; callers can read drafts in the editor but cannot assemble them.
    return ContentPackSchema.parse({ ...pack, contentStatus: row.status })
  }
  catalog() {
    const rows = this.store.all<PackRow>('SELECT * FROM packs ORDER BY active DESC,version DESC')
    const seen = new Set<string>()
    return { occupations: rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true }).map(row => {
      const p = ContentPackSchema.parse(JSON.parse(row.manifest))
      return { id: p.occupationId, title: p.title, description: p.subtitle, packId: p.id, packVersion: p.version, status: row.active && row.status === 'published' ? 'playable' : 'preparing', synthetic: true, assetManifestVersion: p.assetManifestVersion }
    }), provider: process.env.AI_PROVIDER === 'openai' ? 'openai' : 'mock' }
  }
  overview(identity: Identity) {
    new AuthService(this.store).requireRole(identity, ['editor', 'reviewer', 'admin'])
    const audit=this.store.all<{action:string;resourceId:string;metadata:string;createdAt:string}>('SELECT action,resource_id AS resourceId,metadata,created_at AS createdAt FROM audit_logs ORDER BY created_at DESC LIMIT 60').map(row=>({...row,metadata:JSON.parse(row.metadata) as Record<string,unknown>}))
    return { user: identity.user, roles: identity.user.roles, packs: this.store.all<PackRow>('SELECT * FROM packs').map(row => { const pack = ContentPackSchema.parse(JSON.parse(row.manifest)); return { id: row.id, version: Number(row.version), status: row.status, active: Boolean(row.active), domainReviewStatus: row.domain_review_status, title: pack.title, manifest: pack } }), stats: { sessions: this.store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions')!.n, contentTemplates: this.store.get<{ n: number }>('SELECT COUNT(*) n FROM templates')!.n },audit, assetGate: checkAssets(demoPack), provider: { name: process.env.AI_PROVIDER || 'mock', model: process.env.AI_PROVIDER === 'openai' ? process.env.OPENAI_MODEL || 'gpt-4.1-mini' : 'deterministic-role-v1', promptVersion: demoPack.promptVersion } }
  }
  mutate(identity: Identity, raw: unknown) {
    const input = z.object({ action: z.enum(['clone', 'save', 'check', 'approve', 'publish', 'rollback']), packId: z.string().min(1).max(80), version: z.number().int().positive(), pack: ContentPackSchema.optional(), reviewerType:z.enum(['agent','human']).default('agent'),reason: z.string().trim().min(3).max(1000).default('合成演示内容审核') }).strict().parse(raw)
    const allowed = input.action === 'approve' ? ['reviewer'] : ['publish', 'rollback'].includes(input.action) ? ['admin'] : ['editor']
    new AuthService(this.store).requireRole(identity, allowed)
    return this.store.transaction(() => {
      const row = this.store.get<PackRow>('SELECT * FROM packs WHERE id=? AND version=?', input.packId, String(input.version))
      invariant(row, 'PACK_NOT_FOUND', 404, '内容版本不存在。')
      let pack = ContentPackSchema.parse(JSON.parse(row.manifest))
      if (input.action === 'clone') {
        const maxVersion = this.store.get<{ n: number }>('SELECT MAX(CAST(version AS INTEGER)) n FROM packs WHERE id=?', pack.id)!.n
        pack = ContentPackSchema.parse({ ...pack, version: maxVersion + 1, contentStatus: 'draft', contentBuildId: `${pack.contentBuildId}-v${maxVersion + 1}`, nodes: pack.nodes.map(n => ({ ...n, packVersion: maxVersion + 1 })) })
        this.insert(pack, 'draft')
      } else if (input.action === 'save') {
        invariant(row.status === 'draft' && input.pack, 'IMMUTABLE_VERSION', 409, '只有草稿可编辑，请先克隆已发布版本。')
        invariant(input.pack.id === input.packId && input.pack.version === input.version, 'IDENTITY_MISMATCH', 400, '版本身份不可修改。')
        pack = input.pack
        this.store.run('UPDATE packs SET manifest=?,checksum=?,dataset_version=?,content_build_id=?,asset_manifest_version=? WHERE id=? AND version=?', JSON.stringify(pack), hash(canonical(pack)), pack.datasetVersion, pack.contentBuildId, pack.assetManifestVersion, pack.id, String(pack.version))
      } else if (input.action === 'check') {
        invariant(row.status === 'draft', 'INVALID_REVIEW_STATE', 409, '仅草稿可以进入自动检查。')
        const validation = validatePack(pack)
        invariant(validation.valid, 'CONTENT_INVALID', 400, JSON.stringify(validation.issues).slice(0, 1500))
        checkPublishAssembly(pack)
        this.store.run("UPDATE packs SET status='auto_checked' WHERE id=? AND version=?", pack.id, String(pack.version))
      } else if (input.action === 'approve') {
        invariant(row.status === 'auto_checked', 'INVALID_REVIEW_STATE', 409, '请先执行自动检查。')
        this.store.run("UPDATE packs SET status='approved' WHERE id=? AND version=?", pack.id, String(pack.version))
      } else {
        invariant(input.action === 'rollback' ? row.status === 'published' : row.status === 'approved', 'INVALID_REVIEW_STATE', 409, '发布需要审核通过；回退只能指向历史已发布版本。')
        const validation = validatePack(pack), gate = checkAssets(pack)
        invariant(validation.valid && gate.ok, 'PUBLISH_GATE', 409, [...validation.issues, ...gate.errors].join('；').slice(0, 1500))
        invariant(pack.releasePolicy === 'demo' || pack.domainReviewStatus === 'verified', 'DOMAIN_REVIEW_REQUIRED', 409, '行业正式包需要专业审核。')
        checkPublishAssembly(pack)
        this.store.run('UPDATE packs SET active=0 WHERE id=?', pack.id)
        if (input.action === 'publish') pack = ContentPackSchema.parse({ ...pack, contentStatus: 'published', events: pack.events.map(e => ({ ...e, contentStatus: 'published' })) })
        this.store.run("UPDATE packs SET status='published',active=1,manifest=?,checksum=? WHERE id=? AND version=?", JSON.stringify(pack),hash(canonical(pack)),pack.id, String(pack.version))
      }
      this.store.run('INSERT INTO reviews VALUES (?,?,?,?,?,?,?,?)', id(), pack.id, String(pack.version), identity.user.id, input.reviewerType, input.action, input.reason, now())
      this.store.audit(identity.user.id, `content.${input.action}`, `${pack.id}@${pack.version}`, { reason: input.reason })
      return { id: pack.id, version: pack.version, action: input.action }
    })
  }
}
