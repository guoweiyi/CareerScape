import {
  GalgameEventPayloadSchema,
  SaveArchiveV12Schema,
  type SaveArchiveV12,
} from '../../../../packages/contracts/archive-v12'
import {
  GalgameDefinitionSchema,
  GalgameWorldStateSchema,
  type GalgameDefinition,
} from '../../../../packages/contracts/galgame'
import { canonical, hash, id, invariant, now, type Store } from '../../../../packages/database'
import {
  applyGalgameGeneration,
  galgameInputText,
  startGalgame,
} from '../../../../packages/narrative/galgame'
import { checkAssets } from './content'

type Event = SaveArchiveV12['events'][number]
/** Validates a mixed archive before the legacy importer or this writer can mutate anything. */
export class GalgameArchiveService {
  constructor(readonly store: Store) {}
  validate(raw: unknown) {
    const archive = SaveArchiveV12Schema.parse(raw),
      { checksum, ...body } = archive
    invariant(hash(canonical(body)) === checksum, 'ARCHIVE_CHECKSUM', 400, '归档校验和不一致。')
    invariant(archive.sessions.length > 0, 'ARCHIVE_EMPTY', 400, '归档没有旅程。')
    const sessions = new Map(archive.sessions.map((row) => [row.id, row])),
      branches = new Map(archive.branches.map((row) => [row.id, row])),
      eventIds = new Map(archive.events.map((row) => [row.id, row]))
    for (const [rows, keys] of [
      [archive.sessions, archive.sessions.map((row) => row.id)],
      [archive.branches, archive.branches.map((row) => row.id)],
      [archive.events, archive.events.map((row) => row.id)],
      [archive.snapshots, archive.snapshots.map((row) => row.id)],
      [archive.galgameInstances, archive.galgameInstances.map((row) => row.branch_id)],
      [archive.instances, archive.instances.map((row) => row.branch_id)],
      [archive.journals, archive.journals.map((row) => `${row.session_id}:${row.branch_id}`)],
      [archive.feedback, archive.feedback.map((row) => row.id)],
      [archive.packageRefs, archive.packageRefs.map((row) => `${row.id}:${row.version}`)],
    ] as const)
      invariant(new Set(keys).size === rows.length, 'ARCHIVE_DUPLICATE', 400, '归档包含重复记录。')
    for (const session of archive.sessions) {
      invariant(
        session.owner_id === archive.owner.id &&
          branches.get(session.current_branch_id)?.session_id === session.id,
        'ARCHIVE_OWNER',
        400,
        '会话归属或当前路线无效。',
      )
      const own = archive.branches.filter((branch) => branch.session_id === session.id)
      invariant(
        own.filter((branch) => !branch.parent_branch_id).length === 1 && own.length <= 50,
        'ARCHIVE_ROOT',
        400,
        '每局需要一个根分支，最多50条路线。',
      )
      const events = archive.events
        .filter((event) => event.session_id === session.id)
        .sort((a, b) => a.event_seq - b.event_seq)
      invariant(
        events.every((event, index) => event.event_seq === index + 1),
        'ARCHIVE_SEQUENCE',
        400,
        '会话事件序号不连续。',
      )
      invariant(
        archive.packageRefs.some(
          (ref) => ref.id === session.pack_id && String(ref.version) === session.pack_version,
        ),
        'ARCHIVE_PACK_VERSION',
        400,
        '冻结资料引用缺失。',
      )
    }
    const scoped = (sessionId: string, branchId: string) =>
      sessions.has(sessionId) && branches.get(branchId)?.session_id === sessionId
    for (const branch of archive.branches) {
      invariant(
        sessions.has(branch.session_id) &&
          (!branch.parent_branch_id || scoped(branch.session_id, branch.parent_branch_id)),
        'ARCHIVE_BRANCH',
        400,
        '路线不属于同一局。',
      )
      const visited = new Set<string>()
      let current: typeof branch | undefined = branch
      while (current) {
        invariant(
          !visited.has(current.id) && visited.size < 100,
          'ARCHIVE_CYCLE',
          400,
          '路线关系存在循环或过深。',
        )
        visited.add(current.id)
        current = current.parent_branch_id ? branches.get(current.parent_branch_id) : undefined
      }
    }
    for (const row of [
      ...archive.events,
      ...archive.snapshots,
      ...archive.journals,
      ...archive.instances,
      ...archive.galgameInstances,
    ])
      invariant(
        scoped(row.session_id, row.branch_id),
        'ARCHIVE_REFERENCES',
        400,
        '记录引用了不存在的会话或路线。',
      )
    for (const feedback of archive.feedback)
      invariant(
        feedback.owner_id === archive.owner.id && (!feedback.session_id || sessions.has(feedback.session_id)),
        'ARCHIVE_FEEDBACK',
        400,
        '反馈归属无效。',
      )
    for (const instance of archive.instances)
      invariant(
        sessions.get(instance.session_id)?.mode === 'story',
        'ARCHIVE_INSTANCE_MODE',
        400,
        '冻结实例与模式不一致。',
      )
    for (const instance of archive.galgameInstances)
      invariant(
        sessions.get(instance.session_id)?.mode === 'galgame',
        'ARCHIVE_INSTANCE_MODE',
        400,
        '职业实例与模式不一致。',
      )
    const ownEvents = (branchId: string) =>
      archive.events.filter((event) => event.branch_id === branchId).sort((a, b) => a.event_seq - b.event_seq)
    const lineage = (branchId: string): Event[] => {
      const branch = branches.get(branchId)!
      return [
        ...(branch.parent_branch_id
          ? lineage(branch.parent_branch_id).filter((event) => event.event_seq <= branch.fork_event_seq)
          : []),
        ...ownEvents(branchId),
      ]
    }
    const definitions = new Map<string, GalgameDefinition>()
    for (const session of archive.sessions.filter((session) => session.mode === 'galgame')) {
      const ref = archive.packageRefs.find(
        (ref) => ref.id === session.pack_id && String(ref.version) === session.pack_version,
      )!
      const row = this.store.get<{ manifest: string; checksum: string; status: string; mode: string }>(
        'SELECT manifest,checksum,status,mode FROM packs WHERE id=? AND version=?',
        session.pack_id,
        session.pack_version,
      )
      invariant(
        row?.mode === 'galgame' && row.status === 'published' && row.checksum === ref.checksum,
        'ARCHIVE_PACK_VERSION',
        409,
        '冻结职业资料不存在、已撤回或校验和不一致。',
      )
      const definition = GalgameDefinitionSchema.parse(JSON.parse(row.manifest))
      invariant(
        definition.id === session.pack_id &&
          String(definition.version) === session.pack_version &&
          hash(canonical(definition)) === row.checksum &&
          definition.assetManifestVersion === ref.assetManifestVersion &&
          checkAssets(definition).ok,
        'ARCHIVE_ASSET_VERSION',
        409,
        '冻结职业资料或资源不可用。',
      )
      definitions.set(session.id, definition)
      for (const branch of archive.branches.filter((branch) => branch.session_id === session.id)) {
        const instance = archive.galgameInstances.find((instance) => instance.branch_id === branch.id)
        invariant(
          instance && instance.prompt_version === definition.promptVersion,
          'ARCHIVE_INSTANCE',
          400,
          '每条职业路线都需要冻结的开局资料。',
        )
        const parentInstance = branch.parent_branch_id
          ? archive.galgameInstances.find((instance) => instance.branch_id === branch.parent_branch_id)
          : undefined
        if (parentInstance)
          invariant(
            instance.seed === parentInstance.seed &&
              instance.player === parentInstance.player &&
              instance.prompt_version === parentInstance.prompt_version,
            'ARCHIVE_PLAYER',
            400,
            '回溯不能改变冻结人物设定。',
          )
        const prefix = branch.parent_branch_id
          ? lineage(branch.parent_branch_id).find((event) => event.event_seq === branch.fork_event_seq)
          : undefined
        invariant(
          branch.parent_branch_id ? Boolean(prefix) : branch.fork_event_seq === 0,
          'ARCHIVE_FORK_POINT',
          400,
          '回溯点不在父路线中。',
        )
        let state = prefix
            ? GalgameWorldStateSchema.parse(JSON.parse(prefix.state_after))
            : startGalgame(definition),
          revision = 0,
          started = Boolean(prefix)
        for (const event of ownEvents(branch.id)) {
          const payload = GalgameEventPayloadSchema.parse(JSON.parse(event.payload))
          invariant(
            event.event_seq > branch.fork_event_seq,
            'ARCHIVE_BRANCH_ORDER',
            400,
            '路线事件早于回溯点。',
          )
          if (event.kind === 'session_started') {
            invariant(
              !started &&
                event.event_seq === 1 &&
                event.actor === 'system' &&
                event.channel === 'group' &&
                event.recipient_id === null &&
                !payload.action &&
                !payload.generation &&
                payload.revision === 0 &&
                !payload.messages.length &&
                canonical(payload.instance) === canonical(instance),
              'ARCHIVE_START',
              400,
              '开局记录与冻结资料不一致。',
            )
            started = true
          } else {
            invariant(
              started &&
                payload.action &&
                payload.generation &&
                !payload.instance &&
                payload.action.kind === event.kind &&
                payload.action.branchId === branch.id &&
                payload.action.expectedRevision === revision &&
                payload.revision === revision + 1,
              'ARCHIVE_ACTION',
              400,
              '职业行动或修订不连续。',
            )
            const action = payload.action,
              channel = ['explain', 'debrief'].includes(action.kind) ? 'explanation' : action.channel
            invariant(
              event.channel === channel && event.recipient_id === (action.recipientId || null),
              'ARCHIVE_CHANNEL',
              400,
              '职业行动收件范围无效。',
            )
            const evidence = lineage(branch.id)
              .filter(
                (row) =>
                  row.event_seq < event.event_seq &&
                  ['choice', 'act', 'message', 'submit_artifact', 'leave'].includes(row.kind),
              )
              .map((row) => row.event_seq)
            const applied = applyGalgameGeneration(
              definition,
              state,
              action,
              payload.generation,
              event.event_seq,
              evidence,
            )
            const expectedMessages = [
              {
                speakerId: 'player',
                text: galgameInputText(state, action, definition).slice(0, 4000),
                expression: 'neutral',
              },
              ...applied.messages,
            ]
            invariant(
              canonical(
                payload.messages.map(({ speakerId, text, expression }) => ({ speakerId, text, expression })),
              ) === canonical(expectedMessages),
              'ARCHIVE_MESSAGE',
              400,
              '正文与已保存的生成结果不一致。',
            )
            state = applied.state
            revision++
          }
          invariant(
            canonical(state) === canonical(GalgameWorldStateSchema.parse(JSON.parse(event.state_after))),
            'ARCHIVE_STATE',
            400,
            '职业状态不能由已保存的行动和生成结果复现。',
          )
          const availableSources = new Set(
            lineage(branch.id)
              .filter((row) => row.event_seq <= event.event_seq)
              .map((row) => row.id),
          )
          for (const message of payload.messages)
            invariant(
              message.eventSeq === event.event_seq &&
                message.channel === event.channel &&
                (message.recipientId || null) === event.recipient_id &&
                message.sourceEventIds.every(
                  (source) => availableSources.has(source) && eventIds.get(source)?.session_id === session.id,
                ),
              'ARCHIVE_MESSAGE_SOURCE',
              400,
              '正文引用了其他路线或未来事件。',
            )
        }
        invariant(
          started &&
            branch.revision === revision &&
            canonical(state) === canonical(GalgameWorldStateSchema.parse(JSON.parse(branch.state))),
          'ARCHIVE_BRANCH_STATE',
          400,
          '职业路线最终状态与日志不一致。',
        )
        for (const snapshot of archive.snapshots.filter((snapshot) => snapshot.branch_id === branch.id)) {
          const event = lineage(branch.id).find((event) => event.event_seq === snapshot.event_seq)
          invariant(
            event &&
              canonical(GalgameWorldStateSchema.parse(JSON.parse(snapshot.state))) ===
                canonical(GalgameWorldStateSchema.parse(JSON.parse(event.state_after))) &&
              snapshot.revision ===
                (event.branch_id === branch.id
                  ? GalgameEventPayloadSchema.parse(JSON.parse(event.payload)).revision
                  : 0) &&
              (event.branch_id === branch.id || snapshot.event_seq === branch.fork_event_seq),
            'ARCHIVE_SNAPSHOT',
            400,
            '职业快照与日志或回溯点不一致。',
          )
        }
      }
    }
    return archive
  }
  storyArchive(archive: SaveArchiveV12) {
    const storySessions = archive.sessions.filter((session) => session.mode === 'story'),
      ids = new Set(storySessions.map((session) => session.id))
    if (!ids.size) return null
    const body = {
      schemaVersion: '1.1',
      exportedAt: archive.exportedAt,
      owner: archive.owner,
      packageRefs: archive.packageRefs.filter((ref) =>
        storySessions.some(
          (session) => session.pack_id === ref.id && session.pack_version === String(ref.version),
        ),
      ),
      sessions: storySessions.map(({ mode: _mode, ...session }) => session),
      branches: archive.branches.filter((row) => ids.has(row.session_id)),
      instances: archive.instances,
      events: archive.events.filter((row) => ids.has(row.session_id)),
      snapshots: archive.snapshots.filter((row) => ids.has(row.session_id)),
      journals: archive.journals.filter((row) => ids.has(row.session_id)),
      feedback: archive.feedback.filter((row) => !row.session_id || ids.has(row.session_id)),
    }
    return { ...body, checksum: hash(canonical(body)) }
  }
  write(userId: string, archive: SaveArchiveV12) {
    const sessions = archive.sessions.filter((row) => row.mode === 'galgame'),
      owned = new Set(sessions.map((session) => session.id))
    const branches = archive.branches.filter((row) => owned.has(row.session_id)),
      events = archive.events.filter((row) => owned.has(row.session_id))
    const sessionIds = new Map(sessions.map((row) => [row.id, id()])),
      branchIds = new Map(branches.map((row) => [row.id, id()])),
      eventIds = new Map(events.map((row) => [row.id, id()]))
    for (const row of sessions)
      this.store.run(
        'INSERT INTO sessions (id,owner_id,title,pack_id,pack_version,current_branch_id,created_at,updated_at,mode) VALUES (?,?,?,?,?,?,?,?,?)',
        sessionIds.get(row.id),
        userId,
        `${row.title.slice(0, 100)} · 导入副本`,
        row.pack_id,
        row.pack_version,
        branchIds.get(row.current_branch_id),
        row.created_at,
        now(),
        'galgame',
      )
    const inserted = new Set<string>()
    const insert = (branchId: string) => {
      if (inserted.has(branchId)) return
      const row = branches.find((row) => row.id === branchId)!
      if (row.parent_branch_id) insert(row.parent_branch_id)
      this.store.run(
        'INSERT INTO branches VALUES (?,?,?,?,?,?,?)',
        branchIds.get(row.id),
        sessionIds.get(row.session_id),
        row.parent_branch_id ? branchIds.get(row.parent_branch_id) : null,
        row.fork_event_seq,
        row.revision,
        row.state,
        row.created_at,
      )
      inserted.add(branchId)
    }
    for (const branch of branches) insert(branch.id)
    const instances = new Map(
      archive.galgameInstances.map((row) => [
        row.branch_id,
        {
          ...row,
          branch_id: branchIds.get(row.branch_id)!,
          session_id: sessionIds.get(row.session_id)!,
          begin_action_id: id(),
        },
      ]),
    )
    for (const instance of instances.values())
      this.store.run(
        'INSERT INTO galgame_instances VALUES (?,?,?,?,?,?)',
        instance.branch_id,
        instance.session_id,
        instance.seed,
        instance.player,
        instance.begin_action_id,
        instance.prompt_version,
      )
    for (const row of events) {
      const payload = GalgameEventPayloadSchema.parse(JSON.parse(row.payload))
      payload.messages = payload.messages.map((message, index) => ({
        ...message,
        id: `${eventIds.get(row.id)}:${index}`,
        sourceEventIds: message.sourceEventIds.map((source) => eventIds.get(source)!),
      }))
      if (payload.action)
        payload.action = { ...payload.action, branchId: branchIds.get(row.branch_id)!, clientActionId: id() }
      if (payload.instance) payload.instance = instances.get(row.branch_id)!
      this.store.run(
        'INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        eventIds.get(row.id),
        sessionIds.get(row.session_id),
        branchIds.get(row.branch_id),
        row.event_seq,
        row.kind,
        row.actor === 'system' ? 'system' : userId,
        row.channel,
        row.recipient_id,
        JSON.stringify(payload),
        row.state_after,
        row.created_at,
      )
    }
    for (const row of archive.snapshots.filter((row) => owned.has(row.session_id)))
      this.store.run(
        'INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)',
        id(),
        sessionIds.get(row.session_id),
        branchIds.get(row.branch_id),
        row.event_seq,
        row.revision,
        row.state,
        row.created_at,
      )
    for (const row of archive.journals.filter((row) => owned.has(row.session_id)))
      this.store.run(
        'INSERT INTO journals VALUES (?,?,?,?)',
        sessionIds.get(row.session_id),
        branchIds.get(row.branch_id),
        row.text,
        row.updated_at,
      )
    for (const row of archive.feedback.filter((row) =>
      row.session_id
        ? owned.has(row.session_id)
        : !archive.sessions.some((session) => session.mode === 'story'),
    ))
      this.store.run(
        'INSERT INTO feedback VALUES (?,?,?,?,?)',
        id(),
        userId,
        row.session_id ? sessionIds.get(row.session_id) : null,
        row.text,
        row.created_at,
      )
    return [...sessionIds.values()]
  }
}
