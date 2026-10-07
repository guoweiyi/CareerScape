import { z } from 'zod'
import { ActionInputSchema, EffectSchema, GameInstanceSchema, WorldStateSchema } from './index'

const key = z.string().min(1).max(120)
const date = z.string().datetime()
const seq = z.number().int().nonnegative()
const version = z.string().regex(/^[1-9]\d{0,5}$/)
const jsonText = z.string().max(200_000)
export const ArchiveMessageSchema = z.object({ id: key, eventSeq: seq, speakerId: z.enum(['player', 'narrator', 'lin', 'zhou', 'xu']), text: z.string().max(10000), expression: z.enum(['neutral', 'relaxed', 'thinking', 'serious']), channel: z.enum(['group', 'private', 'explanation']), recipientId: z.enum(['lin', 'zhou', 'xu']).optional(), createdAt: date, sourceEventIds: z.array(key).min(1).max(20) }).strict()
export const ArchiveAssemblyFallbackSchema = z.object({ fromPackVersion: z.number().int().positive(), toPackVersion: z.number().int().positive(), reason: z.string().min(1).max(300), requestedSeed: z.string().min(1).max(80) }).strict()
export const ArchiveEventPayloadSchema = z.object({ messages: z.array(ArchiveMessageSchema).max(20), revision: seq, versions: GameInstanceSchema.optional(), assemblyFallback: ArchiveAssemblyFallbackSchema.optional(), action: ActionInputSchema.optional(), effects: z.array(EffectSchema).max(30).optional(), intent: z.object({ kind: z.enum(['leave', 'help', 'choice', 'clarify', 'chat']), choiceId: z.string().max(80).optional(), confidence: z.number().min(0).max(1), confirmationLabel: z.string().max(160) }).strict().optional() }).strict()
export const SaveArchiveSchema = z.object({
  schemaVersion: z.literal('1.1'), exportedAt: date, checksum: z.string().regex(/^[a-f0-9]{64}$/),
  owner: z.object({ id: key, username: z.string().max(32).nullable(), is_guest: z.union([z.literal(0), z.literal(1)]), created_at: date }).strict(),
  packageRefs: z.array(z.object({ id: key, version: z.number().int().positive(), checksum: z.string().regex(/^[a-f0-9]{64}$/), assetManifestVersion: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) }).strict()).max(50),
  sessions: z.array(z.object({ id: key, owner_id: key, title: z.string().max(120), pack_id: key, pack_version: version, current_branch_id: key, created_at: date, updated_at: date }).strict()).max(50),
  branches: z.array(z.object({ id: key, session_id: key, parent_branch_id: key.nullable(), fork_event_seq: seq, revision: seq.max(401), state: jsonText, created_at: date }).strict()).max(500),
  instances: z.array(z.object({ id: key, session_id: key, branch_id: key, pack_version: version, dataset_version: key, content_build_id: key, profile_version: version, asset_manifest_version: key, seed: z.string().max(80), sampler_version: z.literal('constrained-v1'), cast_mapping: jsonText, project_mapping: jsonText, event_pool: jsonText, payload: jsonText }).strict()).max(500),
  events: z.array(z.object({ id: key, session_id: key, branch_id: key, event_seq: seq.min(1), kind: z.enum(['session_started', 'choice', 'message', 'explain', 'leave', 'switch_role']), actor: key, channel: z.enum(['group', 'private', 'explanation']), recipient_id: z.enum(['lin', 'zhou', 'xu']).nullable(), payload: jsonText, state_after: jsonText, created_at: date }).strict()).max(5000),
  snapshots: z.array(z.object({ id: key, session_id: key, branch_id: key, event_seq: seq.min(1), revision: seq.max(401), state: jsonText, created_at: date }).strict()).max(5500),
  journals: z.array(z.object({ session_id: key, branch_id: key, text: z.string().max(10000), updated_at: date }).strict()).max(500),
  feedback: z.array(z.object({ id: key, owner_id: key, session_id: key.nullable(), text: z.string().max(10000), created_at: date }).strict()).max(500),
}).strict()
export type SaveArchive = z.infer<typeof SaveArchiveSchema>

/** Structural checks only; server additionally verifies SHA-256, frozen packages/assets and replayed state. */
export function validateArchiveRelations(archive: SaveArchive): string[] {
  const errors: string[] = []
  const sessions = new Map(archive.sessions.map(row => [row.id, row])); const branches = new Map(archive.branches.map(row => [row.id, row])); const events = new Map(archive.events.map(row => [row.id, row]))
  const unique = (keys: string[], name: string) => { if (new Set(keys).size !== keys.length) errors.push(`${name} ID 重复`) }
  unique(archive.sessions.map(row => row.id), '会话'); unique(archive.branches.map(row => row.id), '分支'); unique(archive.events.map(row => row.id), '事件'); unique(archive.instances.map(row => row.id), '实例'); unique(archive.snapshots.map(row => row.id), '快照'); unique(archive.feedback.map(row => row.id), '反馈')
  unique(archive.events.map(row => `${row.session_id}:${row.event_seq}`), '会话事件序号')
  unique(archive.journals.map(row => `${row.session_id}:${row.branch_id}`), '手账')
  unique(archive.instances.map(row => row.branch_id), '分支实例')
  unique(archive.packageRefs.map(row => `${row.id}:${row.version}`), '包版本')
  for (const session of archive.sessions) {
    if (session.owner_id !== archive.owner.id) errors.push('会话导出归属不一致')
    if (branches.get(session.current_branch_id)?.session_id !== session.id) errors.push('当前分支不属于会话')
    if (!archive.packageRefs.some(ref => ref.id === session.pack_id && String(ref.version) === session.pack_version)) errors.push('会话缺少冻结包引用')
    if (archive.branches.filter(row => row.session_id === session.id && !row.parent_branch_id).length !== 1) errors.push('每个会话必须有唯一根分支')
    if (archive.branches.filter(row => row.session_id === session.id).length > 50) errors.push('单局分支超出上限')
  }
  for (const branch of archive.branches) {
    if (!sessions.has(branch.session_id)) errors.push('分支缺少会话')
    if (branch.parent_branch_id && branches.get(branch.parent_branch_id)?.session_id !== branch.session_id) errors.push('父分支不属于同一会话')
    const visited = new Set<string>(); let current: typeof branch | undefined = branch
    while (current) { if (visited.has(current.id)) { errors.push('分支关系存在循环'); break }; visited.add(current.id); current = current.parent_branch_id ? branches.get(current.parent_branch_id) : undefined }
    if (!archive.instances.some(row => row.branch_id === branch.id)) errors.push('分支缺少冻结实例')
    try { WorldStateSchema.parse(JSON.parse(branch.state)) } catch { errors.push('分支状态无效') }
  }
  const scoped = (sessionId: string, branchId: string) => sessions.has(sessionId) && branches.get(branchId)?.session_id === sessionId
  for (const event of archive.events) {
    if (!scoped(event.session_id, event.branch_id)) errors.push('事件分支归属无效')
    // A claimed guest's historic actor ID can differ from the current owner; import never trusts it for authorization.
    try {
      const payload = ArchiveEventPayloadSchema.parse(JSON.parse(event.payload)); WorldStateSchema.parse(JSON.parse(event.state_after))
      if (event.kind === 'session_started' && (payload.action || !payload.versions || payload.revision !== 0 || event.actor !== 'system')) errors.push('起始事件内容无效')
      if (event.kind !== 'session_started' && (!payload.action || payload.action.kind !== event.kind || payload.action.branchId !== event.branch_id)) errors.push('事件动作与分支不一致')
      if (event.kind !== 'session_started' && payload.assemblyFallback) errors.push('安全包回退只能记录在开局事件')
      for (const message of payload.messages) {
        if (message.eventSeq !== event.event_seq || message.channel !== event.channel || (message.recipientId ?? null) !== event.recipient_id) errors.push('消息与事件频道/序号不一致')
        if (message.channel === 'private' && !message.recipientId) errors.push('私聊缺少收件人')
        if (message.sourceEventIds.some(id => events.get(id)?.session_id !== event.session_id)) errors.push('消息来源事件缺失或跨会话')
      }
    } catch { errors.push('事件正文或状态无效') }
  }
  for (const instance of archive.instances) {
    if (!scoped(instance.session_id, instance.branch_id)) errors.push('实例归属无效')
    try {
      const payload = GameInstanceSchema.parse(JSON.parse(instance.payload)); const session = sessions.get(instance.session_id)
      if (payload.instanceId !== instance.id || payload.packId !== session?.pack_id || String(payload.packVersion) !== instance.pack_version || instance.pack_version !== session?.pack_version || payload.datasetVersion !== instance.dataset_version || payload.contentBuildId !== instance.content_build_id || payload.assetManifestVersion !== instance.asset_manifest_version || String(payload.profileVersion) !== instance.profile_version || payload.seed !== instance.seed || payload.samplerVersion !== instance.sampler_version) errors.push('冻结实例元数据不一致')
      for (const [column, value] of [[instance.cast_mapping, payload.castMapping], [instance.project_mapping, payload.projectMapping], [instance.event_pool, payload.eventPool]] as const) if (JSON.stringify(JSON.parse(column)) !== JSON.stringify(value)) errors.push('实例映射不一致')
    } catch { errors.push('冻结实例无效') }
  }
  for (const snapshot of archive.snapshots) {
    if (!scoped(snapshot.session_id, snapshot.branch_id)) errors.push('快照归属无效')
    try { WorldStateSchema.parse(JSON.parse(snapshot.state)) } catch { errors.push('快照状态无效') }
  }
  for (const journal of archive.journals) if (!scoped(journal.session_id, journal.branch_id)) errors.push('手账归属无效')
  for (const feedback of archive.feedback) if (feedback.owner_id !== archive.owner.id || (feedback.session_id && !sessions.has(feedback.session_id))) errors.push('反馈归属无效')
  return [...new Set(errors)]
}
