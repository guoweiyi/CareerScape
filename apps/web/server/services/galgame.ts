import { z } from 'zod'
import {
  CreateGalgameSchema,
  GalgameActionSchema,
  GalgameDebriefSchema,
  GalgameNpcResponseSchema,
  GalgameSessionDTOSchema,
  GalgameTurnProposalSchema,
  GalgameWorldStateSchema,
  type GalgameAction,
  type GalgameDefinition,
  type GalgameGeneration,
  type GalgameMessage,
  type GalgameSessionDTO,
  type GalgameWorldState,
  type PlayerProfile,
} from '../../../../packages/contracts/galgame'
import { hash, id, invariant, now, AppError, type Store } from '../../../../packages/database'
import {
  createGalgameProvider,
  galgameLimit,
  type GalgameProvider,
  type GalgameModelRequest,
  type GalgameModelUsage,
} from '../../../../packages/agent/galgame'
import {
  applyGalgameGeneration,
  galgameInputText,
  prepareGalgameAction,
  startGalgame,
} from '../../../../packages/narrative/galgame'
import { identityDescriptions } from '../../../../packages/content/galgame'
import { GalgameContentService } from './galgame-content'
import {
  SessionRepository,
  type BranchRow,
  type EventRow,
  type SessionRow,
  type TurnRow,
} from './session-repository'
import { transportMessages } from './game'
import { checkAssets } from './content'

type Instance = {
  branch_id: string
  session_id: string
  seed: string
  player: string
  begin_action_id: string
  prompt_version: string
}
type Receipt = { format: 'galgame-v1'; turnId: string; branchId: string; eventSeq: number }
export class GalgameService extends SessionRepository {
  readonly content: GalgameContentService
  constructor(
    store: Store,
    readonly provider: GalgameProvider = createGalgameProvider(),
  ) {
    super(store)
    this.content = new GalgameContentService(store)
  }
  instance(sessionId: string, branchId: string) {
    const row = this.store.get<Instance>(
      'SELECT * FROM galgame_instances WHERE session_id=? AND branch_id=?',
      sessionId,
      branchId,
    )
    invariant(row, 'INSTANCE_MISSING', 409, '职业故事资料缺失。')
    return row
  }
  messages(events: EventRow[]): GalgameMessage[] {
    return events.flatMap(
      (event) => (JSON.parse(event.payload) as { messages?: GalgameMessage[] }).messages || [],
    )
  }
  get(userId: string, sessionId: string, branchId?: string, throughEventSeq?: number): GalgameSessionDTO {
    const session = this.owned(userId, sessionId, 'galgame'),
      branch = this.branch(sessionId, branchId || session.current_branch_id)
    const definition = this.content.get(session.pack_id, session.pack_version),
      instance = this.instance(sessionId, branch.id)
    const events = this.lineage(sessionId, branch.id).filter(
      (event) => throughEventSeq === undefined || event.event_seq <= throughEventSeq,
    )
    const last = events.at(-1)!
    const state = GalgameWorldStateSchema.parse(
      JSON.parse(throughEventSeq === undefined ? branch.state : last.state_after),
    )
    const revision =
      throughEventSeq === undefined
        ? branch.revision
        : last.branch_id === branch.id
          ? (JSON.parse(last.payload) as { revision: number }).revision
          : 0
    const messages = this.messages(events),
      visible = transportMessages(messages, 60000)
    const result = GalgameSessionDTOSchema.parse({
      mode: 'galgame',
      id: session.id,
      title: session.title,
      branchId: branch.id,
      revision,
      eventSeq: last.event_seq,
      status: state.phase === 'playing' ? 'active' : state.phase,
      packId: definition.id,
      packVersion: definition.version,
      assetManifestVersion: definition.assetManifestVersion,
      careerId: definition.careerId,
      occupationTitle: definition.occupationTitle,
      player: JSON.parse(instance.player),
      scene: state.scene,
      choices: state.choices,
      characters: state.characters.map(({ id, name, role, expression }) => ({ id, name, role, expression })),
      tasks: state.tasks,
      artifacts: state.artifacts,
      minutes: state.minutes,
      outcome: state.outcome,
      debrief: state.debrief,
      sources: definition.sources,
      facts: definition.facts
        .filter((fact) => state.knowledge.player.includes(fact.id))
        .map(({ id, text, origin }) => ({ id, text, origin })),
      taskBrief: definition.task.brief,
      responsibilities: definition.responsibilities,
      authority: definition.authority,
      artifactFields: definition.artifactFields,
      messages: visible,
      hasMoreHistory: messages.length > visible.length,
      branches: this.store
        .all<BranchRow>('SELECT * FROM branches WHERE session_id=? ORDER BY created_at', sessionId)
        .map((row) => ({
          id: row.id,
          parentBranchId: row.parent_branch_id,
          forkEventSeq: row.fork_event_seq,
          revision: row.id === branch.id ? revision : row.revision,
          label: row.parent_branch_id ? `从事件 ${row.fork_event_seq} 回溯` : '原始路线',
        })),
      beginActionId: instance.begin_action_id,
      createdAt: session.created_at,
      updatedAt: throughEventSeq === undefined ? session.updated_at : last.created_at,
      provider: this.provider.name,
    })
    invariant(
      Buffer.byteLength(JSON.stringify(result), 'utf8') < 220000,
      'SNAPSHOT_TOO_LARGE',
      409,
      '存档传输容量已满，请精简材料。',
    )
    return result
  }
  list(userId: string) {
    return this.store
      .all<SessionRow>(
        "SELECT * FROM sessions WHERE owner_id=? AND mode='galgame' ORDER BY updated_at DESC",
        userId,
      )
      .map((session) => {
        const branch = this.branch(session.id, session.current_branch_id),
          state = GalgameWorldStateSchema.parse(JSON.parse(branch.state))
        return {
          mode: 'galgame' as const,
          id: session.id,
          title: session.title,
          branchId: branch.id,
          revision: branch.revision,
          packId: session.pack_id,
          packVersion: Number(session.pack_version),
          status: state.phase === 'ended' ? 'ended' : 'active',
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        }
      })
  }
  history(userId: string, sessionId: string, branchId: string, beforeEventSeq = Number.MAX_SAFE_INTEGER) {
    this.owned(userId, sessionId, 'galgame')
    const events = this.lineage(sessionId, branchId).filter((event) => event.event_seq < beforeEventSeq),
      page = events.slice(-12)
    return {
      messages: this.messages(page),
      hasMore: events.length > page.length,
      nextBeforeEventSeq: page[0]?.event_seq || null,
    }
  }
  create(userId: string, raw: unknown) {
    const input = CreateGalgameSchema.parse(raw)
    invariant(this.provider.available, 'AI_UNAVAILABLE', 503, 'AI 职业故事暂未开放，请稍后再试。')
    const definition = this.content.forCareer(input.careerId)
    invariant(checkAssets(definition).ok, 'ASSET_UNAVAILABLE', 409, '故事画面资料暂不可用。')
    const sessionId = id(),
      branchId = id(),
      stamp = now(),
      state = startGalgame(definition)
    return this.store.transaction(() => {
      invariant(
        this.store.get('SELECT id FROM users WHERE id=?', userId),
        'UNAUTHORIZED',
        401,
        '请重新登录。',
      )
      invariant(
        this.store.get<{ n: number }>('SELECT COUNT(*) n FROM sessions WHERE owner_id=?', userId)!.n < 50,
        'SESSION_LIMIT',
        409,
        '已保存50局，请先管理已有旅程。',
      )
      this.store.run(
        'INSERT INTO sessions (id,owner_id,title,pack_id,pack_version,current_branch_id,created_at,updated_at,mode) VALUES (?,?,?,?,?,?,?,?,?)',
        sessionId,
        userId,
        definition.title,
        definition.id,
        String(definition.version),
        branchId,
        stamp,
        stamp,
        'galgame',
      )
      this.store.run(
        'INSERT INTO branches VALUES (?,?,NULL,0,0,?,?)',
        branchId,
        sessionId,
        JSON.stringify(state),
        stamp,
      )
      const instance = {
        branch_id: branchId,
        session_id: sessionId,
        seed: input.seed || id(),
        player: JSON.stringify(input.player),
        begin_action_id: hash(`${sessionId}:begin`),
        prompt_version: definition.promptVersion,
      }
      this.store.run(
        'INSERT INTO galgame_instances VALUES (?,?,?,?,?,?)',
        branchId,
        sessionId,
        instance.seed,
        instance.player,
        instance.begin_action_id,
        instance.prompt_version,
      )
      this.store.run(
        'INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        id(),
        sessionId,
        branchId,
        1,
        'session_started',
        'system',
        'group',
        null,
        JSON.stringify({ messages: [], revision: 0, instance }),
        JSON.stringify(state),
        stamp,
      )
      this.store.run(
        'INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)',
        id(),
        sessionId,
        branchId,
        1,
        0,
        JSON.stringify(state),
        stamp,
      )
      return this.get(userId, sessionId)
    })
  }
  private replay(userId: string, sessionId: string, receipt: Receipt) {
    const session = this.get(userId, sessionId, receipt.branchId, receipt.eventSeq)
    const event = this.lineage(sessionId, receipt.branchId).find(
      (event) => event.event_seq === receipt.eventSeq,
    )!
    return { turnId: receipt.turnId, session, messages: this.messages([event]), replayed: true }
  }
  private chargeQuota(userId: string) {
    const day = now().slice(0, 10),
      limit = galgameLimit('GALGAME_DAILY_TURNS', 30, 1, 1000)
    this.store.transaction(() => {
      const used =
        this.store.get<{ attempts: number }>(
          'SELECT attempts FROM galgame_quotas WHERE user_id=? AND day=?',
          userId,
          day,
        )?.attempts || 0
      invariant(used < limit, 'AI_DAILY_LIMIT', 429, '今天的 AI 故事额度已用完；记录已保存，可以稍后继续。')
      this.store.run(
        'INSERT INTO galgame_quotas VALUES (?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET attempts=attempts+1',
        userId,
        day,
      )
    })
  }
  private async generate(
    definition: GalgameDefinition,
    before: GalgameWorldState,
    action: GalgameAction,
    instance: Instance,
    events: EventRow[],
    eventSeq: number,
    record: (usage: GalgameModelUsage) => void,
  ) {
    const candidate = prepareGalgameAction(definition, before, action, eventSeq),
      player = JSON.parse(instance.player) as PlayerProfile
    const signal = AbortSignal.timeout(galgameLimit('GALGAME_TIMEOUT_MS', 60000, 1000, 60000))
    let calls = 0,
      corrected = false
    const request = async <T>(schema: z.ZodType<T>, input: GalgameModelRequest): Promise<T> => {
      invariant(++calls <= 4, 'AI_CALL_LIMIT', 422, '本回合生成次数已达上限，未保存。')
      try {
        return await this.provider.generate(schema, input, signal, record)
      } catch (error) {
        if (
          error instanceof AppError &&
          ['AI_INVALID_OUTPUT', 'AI_OUTPUT_TRUNCATED'].includes(error.code) &&
          !corrected &&
          calls < 4 &&
          !signal.aborted
        ) {
          corrected = true
          return request(schema, {
            ...input,
            context: {
              ...input.context,
              correction: '上一次输出不完整或不符合schema。请精简长度，并仅返回完整且符合schema的JSON对象。',
            },
          })
        }
        throw error
      }
    }
    const allMessages = this.messages(events)
    const knownFacts = (person: 'player' | 'lin' | 'zhou' | 'xu') =>
      definition.facts
        .filter(
          (fact) =>
            candidate.knowledge[person].includes(fact.id) &&
            (action.kind !== 'explain' || candidate.knowledge.player.includes(fact.id)),
        )
        .map(({ id, text }) => ({ id, text }))
    const history = (person?: 'lin' | 'zhou' | 'xu') =>
      allMessages
        .filter(
          (message) =>
            message.speakerId !== 'narrator' &&
            (message.channel === 'group' ||
              (person && message.channel === 'private' && message.recipientId === person)),
        )
        .slice(-12)
        .map((message) => ({
          eventSeq: message.eventSeq,
          speakerId: message.speakerId,
          text: message.text.slice(0, 500),
          channel: message.channel,
        }))
    const shared = {
      player: { ...player, identityDescription: identityDescriptions[player.identity].description },
      occupationTitle: definition.occupationTitle,
      taskBrief: definition.task.brief,
      responsibilities: definition.responsibilities,
      authority: definition.authority,
      sources: definition.sources,
      promptVersion: instance.prompt_version,
      currentInput: galgameInputText(before, action, definition),
      actionKind: action.kind,
    }
    const generation: GalgameGeneration = { npcs: [] }
    if (action.kind === 'debrief') {
      const evidence = events
        .filter((event) => ['choice', 'act', 'message', 'submit_artifact', 'leave'].includes(event.kind))
        .slice(-30)
        .map((event) => {
          const payload = JSON.parse(event.payload) as { action: GalgameAction }
          return {
            eventSeq: event.event_seq,
            kind: event.kind,
            text: payload.action.text?.slice(0, 500),
            choiceId: payload.action.choiceId,
            artifactId: payload.action.artifact?.id,
          }
        })
      generation.debrief = await request(GalgameDebriefSchema, {
        role: 'debrief',
        context: {
          ...shared,
          outcome: candidate.outcome,
          tasks: candidate.tasks,
          evidence,
          artifacts: candidate.artifacts.map((artifact) => ({
            ...artifact,
            fields: Object.fromEntries(
              Object.entries(artifact.fields).map(([key, text]) => [key, text.slice(0, 400)]),
            ),
          })),
        },
      })
      return generation
    }
    if (['begin', 'choice', 'act', 'submit_artifact'].includes(action.kind)) {
      generation.director = await request(GalgameTurnProposalSchema, {
        role: 'director',
        context: {
          ...shared,
          facts: knownFacts('player'),
          history: history(),
          currentScene: before.scene,
          minutes: candidate.minutes,
          tasks: candidate.tasks,
          submittedArtifact: action.artifact || null,
          artifacts: candidate.artifacts.map((artifact) => ({
            id: artifact.id,
            review: artifact.review?.decision || 'pending',
          })),
          characters: candidate.characters,
          seed: instance.seed,
        },
      })
    }
    const speakers =
      action.channel === 'private'
        ? [action.recipientId!]
        : generation.director
          ? action.artifact
            ? [
                definition.mentorId,
                ...generation.director.activeNpcIds.filter((id) => id !== definition.mentorId),
              ].slice(0, 2)
            : generation.director.activeNpcIds
          : [definition.mentorId]
    // Role requests never receive other NPCs' memory, private history or hidden facts.
    for (const characterId of speakers) {
      const character = { ...candidate.characters.find((character) => character.id === characterId)! }
      const goal = generation.director?.goals.find((goal) => goal.characterId === characterId)
      if (goal) character.goal = goal.goal
      const response = await request(GalgameNpcResponseSchema, {
        role: 'npc',
        context: {
          ...shared,
          character,
          facts: knownFacts(characterId),
          history: history(characterId),
          memories: action.kind === 'explain' ? [] : candidate.memories[characterId],
          tasks: candidate.tasks,
          isReviewer: Boolean(action.artifact && characterId === definition.mentorId),
          artifact: action.artifact && characterId === definition.mentorId ? action.artifact : null,
          eventType: generation.director?.eventType || action.kind,
          scene: generation.director
            ? {
                id: generation.director.scene.id,
                title: generation.director.scene.title,
                background: generation.director.scene.background,
              }
            : null,
        },
      })
      generation.npcs.push({ characterId, response })
    }
    return generation
  }
  async act(
    userId: string,
    sessionId: string,
    raw: unknown,
    status?: (stage: 'generating' | 'validating' | 'saving') => void,
  ) {
    const action = GalgameActionSchema.parse(raw)
    this.owned(userId, sessionId, 'galgame')
    const { prepared, turnId, lease, requestHash } = this.claimTurn<Receipt>(
      userId,
      sessionId,
      action,
      75000,
      60,
    )
    if ('receipt' in prepared && prepared.receipt) return this.replay(userId, sessionId, prepared.receipt)
    try {
      const session = prepared.session!,
        branch = prepared.branch!,
        definition = this.content.get(session.pack_id, session.pack_version),
        instance = this.instance(sessionId, action.branchId)
      const state = GalgameWorldStateSchema.parse(JSON.parse(branch.state)),
        events = this.lineage(sessionId, action.branchId)
      const eventSeq = this.store.get<{ n: number }>(
        'SELECT COALESCE(MAX(event_seq),0)+1 n FROM event_logs WHERE session_id=?',
        sessionId,
      )!.n
      prepareGalgameAction(definition, state, action, eventSeq)
      if (action.kind !== 'leave') {
        invariant(this.provider.available, 'AI_UNAVAILABLE', 503, 'AI 职业故事暂不可用，记录已保存。')
        this.chargeQuota(userId)
      }
      const record = (usage: GalgameModelUsage) => {
        this.store.run(
          'INSERT INTO galgame_model_attempts SELECT ?,id,?,?,?,?,?,?,?,? FROM turns WHERE id=?',
          id(),
          usage.model,
          usage.role,
          usage.status,
          usage.inputTokens,
          usage.outputTokens,
          usage.latencyMs,
          usage.failureCode,
          now(),
          turnId,
        )
      }
      status?.('generating')
      const generation =
        action.kind === 'leave'
          ? { npcs: [] }
          : await this.generate(definition, state, action, instance, events, eventSeq, record)
      status?.('validating')
      const evidenceSeqs = events
        .filter((event) => ['choice', 'act', 'message', 'submit_artifact', 'leave'].includes(event.kind))
        .map((event) => event.event_seq)
      const applied = applyGalgameGeneration(definition, state, action, generation, eventSeq, evidenceSeqs)
      status?.('saving')
      return this.store.transaction(() => {
        const current = this.assertTurnCommit(userId, sessionId, action, turnId, lease),
          stamp = now(),
          eventId = id(),
          revision = current.revision + 1
        invariant(
          this.store.get<{ n: number }>(
            'SELECT COALESCE(MAX(event_seq),0)+1 n FROM event_logs WHERE session_id=?',
            sessionId,
          )!.n === eventSeq,
          'REVISION_CONFLICT',
          409,
          '另一条路线先保存了事件，请查询状态后重试。',
        )
        const channel =
          action.kind === 'explain' || action.kind === 'debrief' ? 'explanation' : action.channel
        const text = galgameInputText(state, action, definition)
        const messages: GalgameMessage[] = [
          { speakerId: 'player' as const, text: text.slice(0, 4000), expression: 'neutral' as const },
          ...applied.messages,
        ].map((message, index) => ({
          ...message,
          id: `${eventId}:${index}`,
          eventSeq,
          channel,
          ...(action.recipientId ? { recipientId: action.recipientId } : {}),
          createdAt: stamp,
          sourceEventIds: [eventId],
        }))
        this.store.run(
          'INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          eventId,
          sessionId,
          action.branchId,
          eventSeq,
          action.kind,
          userId,
          channel,
          action.recipientId || null,
          JSON.stringify({ messages, action, generation, revision }),
          JSON.stringify(applied.state),
          stamp,
        )
        this.store.run(
          'UPDATE branches SET state=?,revision=? WHERE id=?',
          JSON.stringify(applied.state),
          revision,
          action.branchId,
        )
        this.store.run(
          'UPDATE sessions SET current_branch_id=?,updated_at=? WHERE id=?',
          action.branchId,
          stamp,
          sessionId,
        )
        this.store.run(
          'INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)',
          id(),
          sessionId,
          action.branchId,
          eventSeq,
          revision,
          JSON.stringify(applied.state),
          stamp,
        )
        this.store.run(
          "UPDATE turns SET status='committed',lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?",
          stamp,
          turnId,
          lease,
        )
        const result = {
          turnId,
          session: this.get(userId, sessionId, action.branchId),
          messages,
          replayed: false,
        }
        this.store.run(
          'INSERT INTO action_receipts VALUES (?,?,?,?,?,?)',
          sessionId,
          action.clientActionId,
          requestHash,
          turnId,
          JSON.stringify({
            format: 'galgame-v1',
            turnId,
            branchId: action.branchId,
            eventSeq,
          } satisfies Receipt),
          stamp,
        )
        return result
      })
    } catch (error) {
      this.store.run(
        "UPDATE turns SET status='failed',failure_code=?,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='running'",
        error instanceof AppError ? error.code : 'TURN_FAILED',
        now(),
        turnId,
        lease,
      )
      throw error
    }
  }
  turn(userId: string, sessionId: string, clientActionId: string) {
    this.owned(userId, sessionId, 'galgame')
    const turn = this.store.get<TurnRow>(
      'SELECT * FROM turns WHERE session_id=? AND client_action_id=?',
      sessionId,
      clientActionId,
    )
    if (!turn) return { status: 'not_found' }
    const receipt = this.store.get<{ result: string }>(
      'SELECT result FROM action_receipts WHERE session_id=? AND client_action_id=?',
      sessionId,
      clientActionId,
    )
    return {
      status: turn.status === 'running' && turn.lease_until < Date.now() ? 'retryable' : turn.status,
      ...(receipt ? this.replay(userId, sessionId, JSON.parse(receipt.result) as Receipt) : {}),
    }
  }
  fork(userId: string, sessionId: string, raw: unknown) {
    const input = z
      .object({ branchId: z.string().min(1).max(100), eventSeq: z.number().int().positive() })
      .strict()
      .parse(raw)
    return this.store.transaction(() => {
      this.owned(userId, sessionId, 'galgame')
      invariant(
        this.store.get<{ n: number }>('SELECT COUNT(*) n FROM branches WHERE session_id=?', sessionId)!.n <
          50,
        'BRANCH_LIMIT',
        409,
        '最多保存50条路线。',
      )
      const event = this.lineage(sessionId, input.branchId).find(
        (event) => event.event_seq === input.eventSeq,
      )
      invariant(event, 'INVALID_FORK_POINT', 400, '回溯点不在当前路线中。')
      const branchId = id(),
        instance = this.instance(sessionId, input.branchId),
        stamp = now()
      GalgameWorldStateSchema.parse(JSON.parse(event.state_after))
      this.store.run(
        'INSERT INTO branches VALUES (?,?,?,?,0,?,?)',
        branchId,
        sessionId,
        input.branchId,
        input.eventSeq,
        event.state_after,
        stamp,
      )
      this.store.run(
        'INSERT INTO galgame_instances VALUES (?,?,?,?,?,?)',
        branchId,
        sessionId,
        instance.seed,
        instance.player,
        id(),
        instance.prompt_version,
      )
      this.store.run(
        'INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)',
        id(),
        sessionId,
        branchId,
        input.eventSeq,
        0,
        event.state_after,
        stamp,
      )
      this.store.run(
        'UPDATE sessions SET current_branch_id=?,updated_at=? WHERE id=?',
        branchId,
        stamp,
        sessionId,
      )
      return this.get(userId, sessionId, branchId)
    })
  }
}
