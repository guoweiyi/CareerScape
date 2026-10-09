import { GalgameArchiveService } from './archive-galgame'
import { SaveArchiveSchema, ArchiveEventPayloadSchema, validateArchiveRelations, type SaveArchive } from '../../../../packages/contracts/archive'
import { ContentPackSchema, GameInstanceSchema, WorldStateSchema, type ContentPack, type WorldState } from '../../../../packages/contracts'
import { applyChoice, assemble, choicesFor, occurrenceFor, startState } from '../../../../packages/narrative/engine'
import { canonical, hash, id, invariant, now, type Store } from '../../../../packages/database'
import { checkAssets } from './content'
import { legacyPack } from '../../../../packages/content/seed-v1'

type ArchivedEvent = SaveArchive['events'][number]
export class ArchiveService {
  constructor(readonly store: Store) {}
  import(userId: string, raw: unknown): { importedSessions: number; sessionIds: string[]; replayed: boolean } {
    invariant(Buffer.byteLength(JSON.stringify(raw), 'utf8') <= 16 * 1024 * 1024, 'ARCHIVE_TOO_LARGE', 413, '导入文件最多 16 MiB，请按局导出。')
    if (raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion === '1.2') return this.importMixed(userId, raw)
    const archive = SaveArchiveSchema.parse(raw)
    const { checksum, ...body } = archive
    invariant(hash(canonical(body)) === checksum, 'ARCHIVE_CHECKSUM', 400, '归档校验和不一致，文件可能不完整。')
    const relationErrors = validateArchiveRelations(archive)
    invariant(!relationErrors.length, 'ARCHIVE_REFERENCES', 400, relationErrors.join('；'))
    invariant(archive.sessions.length > 0, 'ARCHIVE_EMPTY', 400, '这个归档没有可恢复的旅程。')
    const packs = new Map<string, ContentPack>()
    for (const ref of archive.packageRefs) {
      const row = this.store.get<{ manifest: string; checksum: string; status: string }>('SELECT manifest,checksum,status FROM packs WHERE id=? AND version=?', ref.id, String(ref.version))
      invariant(row && row.status === 'published' && row.checksum === ref.checksum, 'ARCHIVE_PACK_VERSION', 409, '归档使用的冻结内容版本不存在、已撤回或校验和不同。')
      const pack = ContentPackSchema.parse(JSON.parse(row.manifest))
      invariant(pack.assetManifestVersion === ref.assetManifestVersion, 'ARCHIVE_ASSET_VERSION', 409, '归档资源版本与冻结内容不一致。')
      const gate = checkAssets(pack)
      invariant(gate.ok, 'ARCHIVE_ASSET_MISSING', 409, '冻结资源版本不可用，无法继续此归档；原文件未修改。')
      packs.set(`${ref.id}:${ref.version}`, pack)
    }
    const branches = new Map(archive.branches.map(row => [row.id, row]))
    const ownEvents = (branchId: string) => archive.events.filter(event => event.branch_id === branchId).sort((a, b) => a.event_seq - b.event_seq)
    const lineage = (branchId: string): ArchivedEvent[] => {
      const branch = branches.get(branchId)!
      const prefix = branch.parent_branch_id ? lineage(branch.parent_branch_id).filter(event => event.event_seq <= branch.fork_event_seq) : []
      return [...prefix, ...ownEvents(branchId)]
    }
    for (const session of archive.sessions) {
      const pack = packs.get(`${session.pack_id}:${session.pack_version}`)!
      const sessionEvents = archive.events.filter(event => event.session_id === session.id).sort((a, b) => a.event_seq - b.event_seq)
      invariant(sessionEvents.every((event, index) => event.event_seq === index + 1), 'ARCHIVE_SEQUENCE', 400, '会话事件序号不连续。')
      const initialPayload = sessionEvents[0] ? ArchiveEventPayloadSchema.parse(JSON.parse(sessionEvents[0].payload)) : undefined
      const fallback = initialPayload?.assemblyFallback
      for (const branch of archive.branches.filter(row => row.session_id === session.id)) {
        const prefix = branch.parent_branch_id ? lineage(branch.parent_branch_id).find(event => event.event_seq === branch.fork_event_seq) : undefined
        invariant(!branch.parent_branch_id || prefix, 'ARCHIVE_FORK_POINT', 400, '回溯点不在父分支的实际历史中。')
        invariant(branch.parent_branch_id || branch.fork_event_seq === 0, 'ARCHIVE_ROOT', 400, '根分支不能携带回溯点。')
        let state: WorldState = prefix ? WorldStateSchema.parse(JSON.parse(prefix.state_after)) : startState(pack)
        let revision = 0; let started = Boolean(branch.parent_branch_id)
        const instanceRow = archive.instances.find(row => row.branch_id === branch.id)!
        const instance = GameInstanceSchema.parse(JSON.parse(instanceRow.payload))
        const expectedInstance = assemble(pack, instance.seed)
        if (instance.fallback) {
          invariant(fallback && fallback.toPackVersion === pack.version && fallback.fromPackVersion !== pack.version && instance.seed === 'fixed-safe-v1' && canonical(pack) === canonical(legacyPack), 'ARCHIVE_FALLBACK', 400, '回退实例必须绑定固定安全包、固定 seed 与开局记录。')
          expectedInstance.fallback = true
        } else invariant(!fallback, 'ARCHIVE_FALLBACK', 400, '普通实例不能携带安全包回退记录。')
        invariant(canonical({ ...instance, instanceId: '' }) === canonical({ ...expectedInstance, instanceId: '' }), 'ARCHIVE_INSTANCE', 400, '冻结实例映射与该 seed/版本的受约束组局不一致。')
        for (const event of ownEvents(branch.id)) {
          const payload = ArchiveEventPayloadSchema.parse(JSON.parse(event.payload))
          invariant(event.event_seq > branch.fork_event_seq, 'ARCHIVE_BRANCH_ORDER', 400, '新分支事件不能早于回溯点。')
          if (event.kind === 'session_started') {
            invariant(!started && event.event_seq === 1 && payload.revision === 0, 'ARCHIVE_START', 400, '起始事件位置不正确。')
            invariant(payload.versions?.instanceId === instance.instanceId && canonical(payload.versions) === canonical(instance), 'ARCHIVE_INITIAL_INSTANCE', 400, '起始事件的冻结实例与分支不一致。')
            started = true
          } else {
            invariant(started && payload.action, 'ARCHIVE_ACTION', 400, '事件缺少起始记录或实际动作。')
            const action = payload.action
            invariant(action.expectedRevision === revision && payload.revision === revision + 1, 'ARCHIVE_REVISION', 400, '事件修订与实际动作不连续。')
            if (['choice', 'leave', 'switch_role'].includes(action.kind)) {
              invariant(action.channel === 'group', 'ARCHIVE_PRIVATE_EFFECT', 400, '私聊不能修改公开剧情。')
              if (action.kind === 'choice') invariant(choicesFor(pack, state).some(choice => choice.id === action.choiceId) || action.choiceId === 'help', 'ARCHIVE_CHOICE', 400, '归档包含当前节点不可用的选项。')
              const result = applyChoice(pack, state, action.kind === 'choice' ? action.choiceId! : action.kind)
              state = result.state
              invariant(canonical(payload.effects ?? []) === canonical(result.effects), 'ARCHIVE_EFFECT', 400, '归档效果与规则计算不一致。')
            } else invariant(!(payload.effects?.length), 'ARCHIVE_EFFECT', 400, '对话或解释不能携带世界效果。')
            const expectedChannel = action.kind === 'switch_role' || action.kind === 'explain' ? 'explanation' : action.channel
            invariant(event.channel === expectedChannel && event.recipient_id === (action.recipientId ?? null), 'ARCHIVE_CHANNEL', 400, '归档行动的收件范围不一致。')
            revision++
          }
          invariant(canonical(state) === canonical(WorldStateSchema.parse(JSON.parse(event.state_after))), 'ARCHIVE_STATE', 400, '归档状态无法由保存的实际行动复现。')
          const availableSources = new Set(lineage(branch.id).filter(row => row.event_seq <= event.event_seq).map(row => row.id))
          invariant(payload.messages.every(message => message.sourceEventIds.every(source => availableSources.has(source))), 'ARCHIVE_MESSAGE_SOURCE', 400, '消息来源跨越分支或指向未来。')
        }
        invariant(started && branch.revision === revision && canonical(state) === canonical(WorldStateSchema.parse(JSON.parse(branch.state))), 'ARCHIVE_BRANCH_STATE', 400, '分支最后状态或修订与日志不一致。')
        for (const snapshot of archive.snapshots.filter(row => row.branch_id === branch.id)) {
          const event = lineage(branch.id).find(row => row.event_seq === snapshot.event_seq)
          invariant(event && canonical(WorldStateSchema.parse(JSON.parse(snapshot.state))) === canonical(WorldStateSchema.parse(JSON.parse(event.state_after))), 'ARCHIVE_SNAPSHOT', 400, '快照状态与实际日志不一致。')
          const expectedRevision = event.branch_id === branch.id ? ArchiveEventPayloadSchema.parse(JSON.parse(event.payload)).revision : 0
          invariant(snapshot.revision === expectedRevision && (event.branch_id === branch.id || snapshot.event_seq === branch.fork_event_seq), 'ARCHIVE_SNAPSHOT_REVISION', 400, '快照修订与分支回溯点不一致。')
        }
      }
    }
    return this.store.transaction(() => {
      invariant(this.store.get('SELECT id FROM users WHERE id=?', userId), 'UNAUTHORIZED', 401, '请重新登录。')
      const prior = this.store.get<{ metadata: string }>("SELECT metadata FROM audit_logs WHERE actor_id=? AND action='archive.imported' AND resource_id=?", userId, archive.checksum)
      if (prior) {
        const ids = (JSON.parse(prior.metadata) as { sessionIds: string[] }).sessionIds
        if (ids.every(sessionId => this.store.get('SELECT id FROM sessions WHERE id=? AND owner_id=?', sessionId, userId))) return { importedSessions: ids.length, sessionIds: ids, replayed: true }
      }
      const existing = this.store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE owner_id=?', userId)!.n
      invariant(existing + archive.sessions.length <= 50, 'SESSION_LIMIT', 409, '导入后会超过 50 局限制，请先管理现有旅程。')
      const sessionIds = new Map(archive.sessions.map(row => [row.id, id()])); const branchIds = new Map(archive.branches.map(row => [row.id, id()])); const eventIds = new Map(archive.events.map(row => [row.id, id()])); const instanceIds = new Map(archive.instances.map(row => [row.id, id()]))
      for (const row of archive.sessions) this.store.run('INSERT INTO sessions (id,owner_id,title,pack_id,pack_version,current_branch_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', sessionIds.get(row.id), userId, `${row.title.slice(0, 100)} · 导入副本`, row.pack_id, row.pack_version, branchIds.get(row.current_branch_id), row.created_at, now())
      const inserted = new Set<string>()
      const insertBranch = (oldId: string) => {
        if (inserted.has(oldId)) return
        const row = branches.get(oldId)!
        if (row.parent_branch_id) insertBranch(row.parent_branch_id)
        this.store.run('INSERT INTO branches VALUES (?,?,?,?,?,?,?)', branchIds.get(oldId), sessionIds.get(row.session_id), row.parent_branch_id ? branchIds.get(row.parent_branch_id) : null, row.fork_event_seq, row.revision, row.state, row.created_at); inserted.add(oldId)
      }
      for (const row of archive.branches) insertBranch(row.id)
      for (const row of archive.instances) {
        const payload = GameInstanceSchema.parse(JSON.parse(row.payload)); payload.instanceId = instanceIds.get(row.id)!
        this.store.run('INSERT INTO game_instances VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', payload.instanceId, sessionIds.get(row.session_id), branchIds.get(row.branch_id), row.pack_version, row.dataset_version, row.content_build_id, row.profile_version, row.asset_manifest_version, row.seed, row.sampler_version, row.cast_mapping, row.project_mapping, row.event_pool, JSON.stringify(payload))
      }
      for (const row of archive.events) {
        const payload = ArchiveEventPayloadSchema.parse(JSON.parse(row.payload))
        payload.messages = payload.messages.map((message, index) => ({ ...message, id: `${eventIds.get(row.id)}:${index}`, sourceEventIds: message.sourceEventIds.map(source => eventIds.get(source)!) }))
        if (payload.action) payload.action = { ...payload.action, branchId: branchIds.get(payload.action.branchId)!, clientActionId: id() }
        if (payload.versions) payload.versions.instanceId = instanceIds.get(payload.versions.instanceId)!
        this.store.run('INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)', eventIds.get(row.id), sessionIds.get(row.session_id), branchIds.get(row.branch_id), row.event_seq, row.kind, row.actor === 'system' ? 'system' : userId, row.channel, row.recipient_id, JSON.stringify(payload), row.state_after, row.created_at)
      }
      for (const row of archive.snapshots) this.store.run('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)', id(), sessionIds.get(row.session_id), branchIds.get(row.branch_id), row.event_seq, row.revision, row.state, row.created_at)
      for (const row of archive.journals) this.store.run('INSERT INTO journals VALUES (?,?,?,?)', sessionIds.get(row.session_id), branchIds.get(row.branch_id), row.text, row.updated_at)
      for (const row of archive.feedback) this.store.run('INSERT INTO feedback VALUES (?,?,?,?,?)', id(), userId, row.session_id ? sessionIds.get(row.session_id) : null, row.text, row.created_at)
      // Rebuild frozen template occurrences from each branch's actual visited prefix, without generating new text.
      for (const row of archive.instances) {
        const session = archive.sessions.find(item => item.id === row.session_id)!, pack = packs.get(`${session.pack_id}:${session.pack_version}`)!, instance = GameInstanceSchema.parse(JSON.parse(row.payload)), seen = new Set<string>()
        for (const event of lineage(row.branch_id)) {
          const occurrence = occurrenceFor(pack, instance, WorldStateSchema.parse(JSON.parse(event.state_after)))
          if (occurrence && !seen.has(occurrence.id)) { this.store.run('INSERT INTO occurrences VALUES (?,?,?,?,?,?)', id(), instanceIds.get(row.id), occurrence.id, String(occurrence.version), 'committed', event.event_seq); seen.add(occurrence.id) }
        }
      }
      const importedIds = [...sessionIds.values()]
      this.store.audit(userId, 'archive.imported', archive.checksum, { sessionIds: importedIds, sessions: importedIds.length, format: archive.schemaVersion })
      return { importedSessions: importedIds.length, sessionIds: importedIds, replayed: false }
    })
  }
  private importMixed(userId: string, raw: unknown): { importedSessions: number; sessionIds: string[]; replayed: boolean } {
    const importer = new GalgameArchiveService(this.store), archive = importer.validate(raw)
    return this.store.transaction(() => {
      invariant(this.store.get('SELECT id FROM users WHERE id=?', userId), 'UNAUTHORIZED', 401, '请重新登录。')
      const prior = this.store.get<{ metadata: string }>("SELECT metadata FROM audit_logs WHERE actor_id=? AND action='archive.imported' AND resource_id=?", userId, archive.checksum)
      if (prior) {
        const ids = (JSON.parse(prior.metadata) as { sessionIds: string[] }).sessionIds
        if (ids.every(sessionId => this.store.get('SELECT id FROM sessions WHERE id=? AND owner_id=?', sessionId, userId))) return { importedSessions: ids.length, sessionIds: ids, replayed: true }
      }
      invariant(this.store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE owner_id=?', userId)!.n + archive.sessions.length <= 50, 'SESSION_LIMIT', 409, '导入后会超过50局限制。')
      const story = importer.storyArchive(archive)
      const storyIds = story ? this.import(userId, story).sessionIds : []
      const galgameIds = importer.write(userId, archive), sessionIds = [...storyIds, ...galgameIds]
      this.store.audit(userId, 'archive.imported', archive.checksum, { sessionIds, sessions: sessionIds.length, format: '1.2' })
      return { importedSessions: sessionIds.length, sessionIds, replayed: false }
    })
  }

}
