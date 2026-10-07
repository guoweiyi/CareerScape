import { z } from 'zod'
import type { Store} from '../../../../packages/database';
import { id, now, hash, canonical, invariant, AppError } from '../../../../packages/database'
import { ActionInputSchema, WorldStateSchema, type NarrativeMessage, type GameInstance } from '../../../../packages/contracts'
import { startState, nodeFor, choicesFor, applyChoice, assemble, occurrenceFor } from '../../../../packages/narrative/engine'
import { buildRoleContext, createProvider, MockProvider, type ProviderResult, type RoleProvider } from '../../../../packages/agent'
import { ContentService } from './content'

type SessionRow = { id: string; owner_id: string; title: string; pack_id: string; pack_version: string; current_branch_id: string; created_at: string; updated_at: string }
type BranchRow = { id: string; session_id: string; parent_branch_id: string | null; fork_event_seq: number; revision: number; state: string; created_at: string }
type EventRow = { id: string; session_id: string; branch_id: string; event_seq: number; kind: string; actor: string; channel: string; recipient_id: string | null; payload: string; state_after: string; created_at: string }
type TurnRow = { id: string; request_hash: string; lease_token: string; lease_until: number; status: string; branch_id: string }
export type GameMessage = { id: string; eventSeq: number; speakerId: 'player' | NarrativeMessage['speakerId']; text: string; expression: NarrativeMessage['expression']; channel: 'group' | 'private' | 'explanation'; recipientId?: string; createdAt: string; sourceEventIds: string[] }
export type SessionDTO = ReturnType<GameService['get']>
export class GameService {
  readonly content: ContentService
  constructor(readonly store: Store, readonly provider: RoleProvider = createProvider()) { this.content = new ContentService(store) }
  owned(userId: string, sessionId: string) {
    const row = this.store.get<SessionRow>('SELECT * FROM sessions WHERE id=? AND owner_id=?', sessionId, userId)
    invariant(row, 'SESSION_NOT_FOUND', 404, '存档不存在或不属于当前账号。')
    return row
  }
  branch(sessionId: string, branchId: string) {
    const branch = this.store.get<BranchRow>('SELECT * FROM branches WHERE id=? AND session_id=?', branchId, sessionId)
    invariant(branch, 'BRANCH_NOT_FOUND', 404, '路线不存在。')
    return branch
  }
  lineage(sessionId: string, branchId: string, depth = 0): EventRow[] {
    invariant(depth < 100, 'BRANCH_DEPTH', 409, '路线层数过多，请从较早路线继续。')
    const b = this.branch(sessionId, branchId)
    const prefix = b.parent_branch_id ? this.lineage(sessionId, b.parent_branch_id, depth + 1).filter(e => e.event_seq <= b.fork_event_seq) : []
    return [...prefix, ...this.store.all<EventRow>('SELECT * FROM event_logs WHERE session_id=? AND branch_id=? ORDER BY event_seq', sessionId, branchId)]
  }
  messages(events: EventRow[]): GameMessage[] { return events.flatMap(e => (JSON.parse(e.payload) as { messages?: GameMessage[] }).messages || []) }
  get(userId: string, sessionId: string, branchId?: string) {
    const session = this.owned(userId, sessionId), branch = this.branch(sessionId, branchId || session.current_branch_id)
    const pack = this.content.get(session.pack_id, session.pack_version), state = WorldStateSchema.parse(JSON.parse(branch.state))
    const node = nodeFor(pack, state), events = this.lineage(sessionId, branch.id)
    const instanceRow = this.store.get<{ payload: string }>('SELECT payload FROM game_instances WHERE session_id=? AND branch_id=?', sessionId, branch.id)!
    const messages=this.messages(events)
    return { id: session.id, title: session.title, branchId: branch.id, revision: branch.revision, eventSeq: events.at(-1)?.event_seq || 0, status: state.endingId ? 'ended' : 'active', packId: pack.id, packVersion: pack.version, assetManifestVersion: pack.assetManifestVersion, state, node, choices: choicesFor(pack, state), messages: messages.slice(-60),hasMoreHistory:messages.length>60, branches: this.store.all<BranchRow>('SELECT * FROM branches WHERE session_id=? ORDER BY created_at', sessionId).map(b => ({ id: b.id, parentBranchId: b.parent_branch_id, forkEventSeq: b.fork_event_seq, revision: b.revision, nodeId: WorldStateSchema.parse(JSON.parse(b.state)).nodeId, label: b.parent_branch_id ? `从事件 ${b.fork_event_seq} 回溯` : '原始路线' })), instance: JSON.parse(instanceRow.payload) as GameInstance, characters: pack.characters, createdAt: session.created_at, updatedAt: session.updated_at, provider: this.provider.name }
  }
  list(userId: string) {
    return { sessions: this.store.all<SessionRow>('SELECT * FROM sessions WHERE owner_id=? ORDER BY updated_at DESC', userId).map(s => {
      const b = this.branch(s.id, s.current_branch_id), state = WorldStateSchema.parse(JSON.parse(b.state))
      return { id: s.id, title: s.title, branchId: b.id, revision: b.revision, packId: s.pack_id, packVersion: Number(s.pack_version), status: state.endingId ? 'ended' : 'active', nodeId: state.nodeId, createdAt: s.created_at, updatedAt: s.updated_at }
    }) }
  }
  history(userId:string,sessionId:string,branchId:string,beforeEventSeq=Number.MAX_SAFE_INTEGER){
    this.owned(userId,sessionId)
    const events=this.lineage(sessionId,branchId).filter(e=>e.event_seq<beforeEventSeq)
    const page=events.slice(-12)
    return {messages:this.messages(page),hasMore:events.length>page.length,nextBeforeEventSeq:page[0]?.event_seq||null}
  }
  create(userId: string, input: unknown) {
    const body = z.object({ packId: z.string().min(1).max(80), seed: z.string().max(80).optional() }).strict().parse(input)
    const pack = this.content.get(body.packId)
    const assembled = { ...assemble(pack, body.seed || id()), instanceId: id() }, state = startState(pack), sessionId = id(), branchId = id(), stamp = now()
    this.store.transaction(() => {
      invariant(this.store.get('SELECT id FROM users WHERE id=?', userId), 'UNAUTHORIZED', 401, '请重新登录。')
      invariant(this.store.get<{n:number}>('SELECT COUNT(*) n FROM sessions WHERE owner_id=?',userId)!.n<50,'SESSION_LIMIT',409,'已保存50局，请先导出或管理已有记录。')
      this.store.run('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)', sessionId, userId, pack.title, pack.id, String(pack.version), branchId, stamp, stamp)
      this.store.run('INSERT INTO branches VALUES (?,?,NULL,0,0,?,?)', branchId, sessionId, JSON.stringify(state), stamp)
      this.insertInstance(sessionId, branchId, assembled)
      const occurrence = occurrenceFor(pack, assembled, state)
      const eventId = id(), messages = this.makeMessages([...nodeFor(pack, state).messages, ...(occurrence?.messages || [])], eventId, 1, stamp, 'group')
      this.store.run('INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)', eventId, sessionId, branchId, 1, 'session_started', 'system', 'group', null, JSON.stringify({ messages, revision: 0, versions: assembled }), JSON.stringify(state), stamp)
      this.store.run('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)', id(), sessionId, branchId, 1, 0, JSON.stringify(state), stamp)
      if (occurrence) this.store.run('INSERT INTO occurrences VALUES (?,?,?,?,?,?)', id(), assembled.instanceId, occurrence.id, String(occurrence.version), 'committed', 1)
    })
    return this.get(userId, sessionId)
  }
  private insertInstance(sessionId: string, branchId: string, instance: GameInstance) {
    this.store.run('INSERT INTO game_instances VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', instance.instanceId, sessionId, branchId, String(instance.packVersion), instance.datasetVersion, instance.contentBuildId, String(instance.profileVersion), instance.assetManifestVersion, instance.seed, instance.samplerVersion, JSON.stringify(instance.castMapping), JSON.stringify(instance.projectMapping), JSON.stringify(instance.eventPool), JSON.stringify(instance))
  }
  private makeMessages(messages: (NarrativeMessage | { speakerId: 'player'; text: string; expression: 'neutral' })[], eventId: string, seq: number, stamp: string, channel: GameMessage['channel'], recipientId?: string): GameMessage[] {
    return messages.map((m, index) => ({ ...m, id: `${eventId}:${index}`, eventSeq: seq, channel, ...(recipientId ? { recipientId } : {}), createdAt: stamp, sourceEventIds: [eventId] }))
  }
  async act(userId: string, sessionId: string, raw: unknown) {
    const input = ActionInputSchema.parse(raw), requestHash = hash(canonical(input)), turnId = hash(`${sessionId}:${input.clientActionId}`), lease = id()
    const prepared = this.store.transaction(() => {
      const session = this.owned(userId, sessionId)
      const receipt = this.store.get<{ request_hash: string; result: string }>('SELECT * FROM action_receipts WHERE session_id=? AND client_action_id=?', sessionId, input.clientActionId)
      if (receipt) { invariant(receipt.request_hash === requestHash, 'ACTION_BODY_CONFLICT', 409, '相同动作编号不能携带不同内容。'); return { receipt: JSON.parse(receipt.result) as { turnId: string; session: SessionDTO; messages: GameMessage[]; replayed: boolean } } }
      const prior = this.store.get<TurnRow>('SELECT * FROM turns WHERE session_id=? AND client_action_id=?', sessionId, input.clientActionId)
      if (prior) {
        invariant(prior.request_hash === requestHash, 'ACTION_BODY_CONFLICT', 409, '相同动作编号不能携带不同内容。')
        invariant(prior.status !== 'running' || prior.lease_until < Date.now(), 'TURN_RUNNING', 409, '动作正在处理中，请查询回合状态。')
      }
      const branch = this.branch(sessionId, input.branchId)
      invariant(branch.revision === input.expectedRevision, 'REVISION_CONFLICT', 409, '存档已在另一页面更新，请刷新后选择。')
      invariant(!this.store.get('SELECT id FROM turns WHERE session_id=? AND branch_id=? AND client_action_id<>? AND status=? AND lease_until>?',sessionId,input.branchId,input.clientActionId,'running',Date.now()),'TURN_RUNNING',409,'当前路线已有动作正在生成，请等待完成。')
      invariant(branch.revision < 400 || input.kind==='leave', 'TURN_LIMIT', 409, '本路线已达回合上限，请回溯或结束。')
      const stamp = now()
      this.store.run('INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,client_action_id) DO UPDATE SET status=excluded.status,lease_token=excluded.lease_token,lease_until=excluded.lease_until,failure_code=NULL,updated_at=excluded.updated_at', turnId, sessionId, branch.id, input.clientActionId, requestHash, input.expectedRevision, 'running', lease, Date.now() + 45000, null, stamp, stamp)
      return { session, branch }
    })
    if ('receipt' in prepared && prepared.receipt) return { ...prepared.receipt, replayed: true }
    try {
      const branch = prepared.branch!, session = prepared.session!, pack = this.content.get(session.pack_id, session.pack_version)
      let state = WorldStateSchema.parse(JSON.parse(branch.state)), messages: (NarrativeMessage | { speakerId: 'player'; text: string; expression: 'neutral' })[] = [], effects: unknown[] = [], channel: GameMessage['channel'] = input.channel
      let usage: ProviderResult | undefined
      const instance = JSON.parse(this.store.get<{payload:string}>('SELECT payload FROM game_instances WHERE session_id=? AND branch_id=?',sessionId,input.branchId)!.payload) as GameInstance
      let occurrence: ReturnType<typeof occurrenceFor>
      if (input.kind === 'choice' || input.kind === 'leave' || input.kind === 'switch_role') {
        invariant(input.channel === 'group', 'PRIVATE_EFFECT_REJECTED', 400, '公开剧情行动请在场景或工作群中执行。')
        const choiceId = input.kind === 'choice' ? input.choiceId! : input.kind
        if(input.kind==='choice')invariant(choiceId==='help'||choicesFor(pack,state).some(choice=>choice.id===choiceId),'CHOICE_UNAVAILABLE',409,'该行动需要使用当前可见的选项或对应专用操作。')
        const result = applyChoice(pack, state, choiceId)
        if(input.kind==='switch_role')channel='explanation'
        const nodeChanged = state.nodeId !== result.state.nodeId
        state = result.state; messages = result.messages; effects = result.effects
        occurrence = nodeChanged ? occurrenceFor(pack, instance, state) : undefined
        if (occurrence && !this.store.get('SELECT id FROM occurrences WHERE instance_id=? AND template_id=?',instance.instanceId,occurrence.id)) messages.push(...occurrence.messages)
        else occurrence = undefined
      } else if (input.kind === 'explain') {
        channel = 'explanation'
        messages = [{ speakerId: 'narrator', expression: 'neutral', text: nodeFor(pack, state).metadata.explanation }]
      } else {
        const speakerId = input.channel === 'private' ? input.recipientId! : 'lin'
        const visible = this.messages(this.lineage(sessionId, input.branchId))
        const context = buildRoleContext(pack, state, speakerId, visible, input.text!, choicesFor(pack, state).map(c => ({ id: c.id, label: c.label })))
        const lineage=this.lineage(sessionId,input.branchId)
        for(const fact of context.facts){
          fact.sourceEventIds=lineage.filter(event=>{const payload=JSON.parse(event.payload) as {effects?:{op:string;characterId?:string;factId?:string}[]};return payload.effects?.some(effect=>effect.op==='reveal'&&effect.characterId===speakerId&&effect.factId===fact.id)}).map(event=>event.id)
        }
        try { usage = await this.provider.generate(context) } catch {
          usage = { ...await new MockProvider().generate(context), degraded: true }
          usage.text = `【模型暂不可用，已降级为模拟对话】${usage.text.replace('【模拟对话】', '')}`
          usage.provider=`${this.provider.name}+mock-fallback`;usage.costEstimate=null;usage.costSource='Provider attempt failed: upstream token/cost usage unknown; zero counters describe fallback only'
        }
        messages = [{ speakerId: 'player', text: input.text!, expression: 'neutral' }, { speakerId, text: usage.text, expression: 'thinking' }]
      }
      return this.store.transaction(() => {
        this.owned(userId, sessionId)
        const current = this.branch(sessionId, input.branchId), currentTurn = this.store.get<TurnRow>('SELECT * FROM turns WHERE id=?', turnId)
        invariant(currentTurn?.lease_token === lease && currentTurn.status === 'running' && currentTurn.lease_until > Date.now(), 'LEASE_LOST', 409, '生成租约已过期，请查询回合后重试。')
        invariant(current.revision === input.expectedRevision, 'REVISION_CONFLICT', 409, '另一个动作先完成，当前结果未提交。')
        const eventSeq = this.store.get<{ n: number }>('SELECT COALESCE(MAX(event_seq),0)+1 n FROM event_logs WHERE session_id=?', sessionId)!.n
        const eventId = id(), stamp = now(), revision = current.revision + 1
        const committedMessages = this.makeMessages(messages, eventId, eventSeq, stamp, channel, input.recipientId)
        this.store.run('INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)', eventId, sessionId, input.branchId, eventSeq, input.kind, userId, channel, input.recipientId || null, JSON.stringify({ messages: committedMessages, action: input, effects, revision }), JSON.stringify(state), stamp)
        this.store.run('UPDATE branches SET revision=?,state=? WHERE id=?', revision, JSON.stringify(state), input.branchId)
        this.store.run('UPDATE sessions SET current_branch_id=?,updated_at=? WHERE id=?', input.branchId, stamp, sessionId)
        this.store.run('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)', id(), sessionId, input.branchId, eventSeq, revision, JSON.stringify(state), stamp)
        if (occurrence) this.store.run('INSERT INTO occurrences VALUES (?,?,?,?,?,?)',id(),instance.instanceId,occurrence.id,String(occurrence.version),'committed',eventSeq)
        this.store.run("UPDATE turns SET status='committed',lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?", stamp, turnId, lease)
        if (usage) this.store.run('INSERT INTO model_calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', id(), turnId, usage.provider, usage.modelVersion, usage.promptVersion, String(pack.version), JSON.stringify(usage.factIds), usage.inputTokens, usage.outputTokens, usage.latencyMs, usage.costEstimate, usage.costSource, stamp)
        const result = { turnId, session: this.get(userId, sessionId, input.branchId), messages: committedMessages, replayed: false }
        this.store.run('INSERT INTO action_receipts VALUES (?,?,?,?,?,?)', sessionId, input.clientActionId, requestHash, turnId, JSON.stringify(result), stamp)
        return result
      })
    } catch (error) {
      this.store.run("UPDATE turns SET status='failed',failure_code=?,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=? AND status='running'", error instanceof AppError ? error.code : 'TURN_FAILED', now(), turnId, lease)
      throw error
    }
  }
  turn(userId: string, sessionId: string, clientActionId: string) {
    this.owned(userId, sessionId)
    const turn = this.store.get<TurnRow>('SELECT * FROM turns WHERE session_id=? AND client_action_id=?', sessionId, clientActionId)
    if (!turn) return { status: 'not_found' }
    const receipt = this.store.get<{ result: string }>('SELECT result FROM action_receipts WHERE session_id=? AND client_action_id=?', sessionId, clientActionId)
    return { status: turn.status === 'running' && turn.lease_until < Date.now() ? 'retryable' : turn.status, ...(receipt ? JSON.parse(receipt.result) as { session: SessionDTO } : {}) }
  }
  fork(userId: string, sessionId: string, raw: unknown) {
    const input = z.object({ branchId: z.string().max(100), eventSeq: z.number().int().positive() }).strict().parse(raw)
    return this.store.transaction(() => {
      const session = this.owned(userId, sessionId)
      invariant(this.store.get<{ n: number }>('SELECT COUNT(*) n FROM branches WHERE session_id=?', sessionId)!.n < 50, 'BRANCH_LIMIT', 409, '最多保留50条路线。')
      const source = this.lineage(sessionId, input.branchId).find(e => e.event_seq === input.eventSeq)
      invariant(source, 'INVALID_FORK_POINT', 400, '回溯点不在当前路线的已提交记录中。')
      const state = WorldStateSchema.parse(JSON.parse(source.state_after)), newBranchId = id(), stamp = now()
      this.store.run('INSERT INTO branches VALUES (?,?,?,?,0,?,?)', newBranchId, sessionId, input.branchId, input.eventSeq, JSON.stringify(state), stamp)
      const oldInstance = this.store.get<{ payload: string }>('SELECT payload FROM game_instances WHERE session_id=? AND branch_id=?', sessionId, input.branchId)!
      const nextInstance = { ...JSON.parse(oldInstance.payload) as GameInstance, instanceId: id() }
      this.insertInstance(sessionId, newBranchId, nextInstance)
      const oldId = (JSON.parse(oldInstance.payload) as GameInstance).instanceId
      for (const occurrence of this.store.all<{template_id:string;template_version:string;status:string;event_seq:number}>('SELECT * FROM occurrences WHERE instance_id=? AND event_seq<=?',oldId,input.eventSeq)) this.store.run('INSERT INTO occurrences VALUES (?,?,?,?,?,?)',id(),nextInstance.instanceId,occurrence.template_id,occurrence.template_version,occurrence.status,occurrence.event_seq)
      this.store.run('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)', id(), sessionId, newBranchId, input.eventSeq, 0, JSON.stringify(state), stamp)
      this.store.run('UPDATE sessions SET current_branch_id=?,updated_at=? WHERE id=?', newBranchId, stamp, session.id)
      return this.get(userId, sessionId, newBranchId)
    })
  }
  journal(userId: string, sessionId: string, branchId?: string, text?: string) {
    const session = this.owned(userId, sessionId), branch = this.branch(sessionId, branchId || session.current_branch_id)
    if (text !== undefined) { z.string().max(10000).parse(text); this.store.run('INSERT INTO journals VALUES (?,?,?,?) ON CONFLICT(session_id,branch_id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at', sessionId, branch.id, text, now()) }
    return this.store.get<{ text: string; updatedAt: string }>('SELECT text,updated_at AS updatedAt FROM journals WHERE session_id=? AND branch_id=?', sessionId, branch.id) || { text: '', updatedAt: null }
  }
}
