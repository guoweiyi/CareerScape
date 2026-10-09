import { z } from 'zod'
import type { Store} from '../../../../packages/database';
import { id, now, hash, canonical, invariant, AppError } from '../../../../packages/database'
import { ActionInputSchema, WorldStateSchema,ContentPackSchema, type NarrativeMessage, type GameInstance } from '../../../../packages/contracts'
import { startState, nodeFor, choicesFor, applyChoice, assemble,assembleWithFallback, occurrenceFor } from '../../../../packages/narrative/engine'
import {legacyPack} from '../../../../packages/content/seed-v1'
import { buildRoleContext, createProvider,detectSupportedIntent,SupportedIntentSchema,type SupportedIntent, type ProviderResult, type RoleProvider } from '../../../../packages/agent'
import { ContentService,checkAssets } from './content'

import { SessionRepository, type SessionRow, type BranchRow, type EventRow, type TurnRow } from './session-repository'
export type GameMessage = { id: string; eventSeq: number; speakerId: 'player' | NarrativeMessage['speakerId']; text: string; expression: NarrativeMessage['expression']; channel: 'group' | 'private' | 'explanation'; recipientId?: string; createdAt: string; sourceEventIds: string[] }
type AssemblyFallback={fromPackVersion:number;toPackVersion:number;reason:string;requestedSeed:string}
export function transportMessages(messages:GameMessage[],maxBytes=100_000){
  const selected:GameMessage[]=[];let bytes=2
  for(let index=messages.length-1;index>=0;){
    const end=index+1,eventSeq=messages[index]!.eventSeq
    while(index>=0&&messages[index]!.eventSeq===eventSeq)index--
    const group=messages.slice(index+1,end),size=group.reduce((sum,message)=>sum+Buffer.byteLength(JSON.stringify(message),'utf8')+1,0)
    invariant(selected.length>0||size+2<=maxBytes,'MESSAGE_EVENT_TOO_LARGE',409,'单次剧情消息超出传输预算，请精简该内容事件。')
    if(bytes+size>maxBytes||selected.length+group.length>60)break
    bytes+=size;selected.unshift(...group)
  }
  return selected
}
export type SessionDTO = ReturnType<GameService['get']>
export class GameService extends SessionRepository {
  readonly content: ContentService
  constructor(store: Store, readonly provider: RoleProvider = createProvider()) { super(store); this.content = new ContentService(store) }
  messages(events: EventRow[]): GameMessage[] { return events.flatMap(e => (JSON.parse(e.payload) as { messages?: GameMessage[] }).messages || []) }
  get(userId: string, sessionId: string, branchId?: string) {
    const session = this.owned(userId, sessionId, 'story'), branch = this.branch(sessionId, branchId || session.current_branch_id)
    const pack = this.content.get(session.pack_id, session.pack_version), state = WorldStateSchema.parse(JSON.parse(branch.state))
    const node = nodeFor(pack, state), events = this.lineage(sessionId, branch.id)
    const instanceRow = this.store.get<{ payload: string }>('SELECT payload FROM game_instances WHERE session_id=? AND branch_id=?', sessionId, branch.id)!
    const messages=this.messages(events),lastEvent=events.at(-1)
    let entered=events[0],previousNode:string|undefined
    for(const event of events){const nodeId=(JSON.parse(event.state_after) as {nodeId:string}).nodeId;if(nodeId!==previousNode)entered=event;previousNode=nodeId}
    const currentNodeVisit={visitId:entered?.id||branch.id,nodeId:state.nodeId,eventSeq:entered?.event_seq||0}
    const parsedIntent=SupportedIntentSchema.safeParse(lastEvent?(JSON.parse(lastEvent.payload) as {intent?:unknown}).intent:undefined)
    const lastIntent=parsedIntent.success?parsedIntent.data:null
    const initialEvent=events.find(event=>event.kind==='session_started')
    const assemblyFallback=initialEvent?(JSON.parse(initialEvent.payload) as {assemblyFallback?:AssemblyFallback}).assemblyFallback||null:null
    const visibleMessages=transportMessages(messages)
    const firstChoice=state.endingId?undefined:choicesFor(pack,state)[0]
    const nextNode=firstChoice?pack.nodes.find(candidate=>candidate.nodeId===firstChoice.targetNodeId):undefined
    const nextSpeaker=nextNode?.messages.find(message=>message.speakerId!=='narrator')
    const prefetchAssetIds=nextNode?[`bg_${nextNode.backgroundId}_day_wide`,...(nextSpeaker?[`chr_${nextSpeaker.speakerId}_work_half_${nextSpeaker.expression}`]:[])].filter(assetId=>pack.assetRefs.includes(assetId)).slice(0,2):[]
    const publicNode={...node,contentRef:'',conditions:[],effects:[],outgoingEdges:[],choices:[],messages:node.messages.slice(0,1),metadata:{...node.metadata,explanation:''}}
    const publicChoices=choicesFor(pack,state).map(choice=>({...choice,targetNodeId:'',conditions:[],effects:[],messages:[]}))
    const snapshot={ id: session.id, title: session.title, branchId: branch.id, revision: branch.revision, eventSeq: events.at(-1)?.event_seq || 0, status: state.endingId ? 'ended' : 'active', packId: pack.id, packVersion: pack.version, assetManifestVersion: pack.assetManifestVersion,prefetchAssetIds, state,currentNodeVisit, node:publicNode, choices:publicChoices, messages:visibleMessages,hasMoreHistory:messages.length>visibleMessages.length,lastIntent,assemblyFallback, branches: this.store.all<BranchRow>('SELECT * FROM branches WHERE session_id=? ORDER BY created_at', sessionId).map(b => ({ id: b.id, parentBranchId: b.parent_branch_id, forkEventSeq: b.fork_event_seq, revision: b.revision, nodeId: WorldStateSchema.parse(JSON.parse(b.state)).nodeId, label: b.parent_branch_id ? `从事件 ${b.fork_event_seq} 回溯` : '原始路线' })), instance: JSON.parse(instanceRow.payload) as GameInstance, characters:pack.characters.map(character=>({id:character.id,name:character.name,role:character.role,age:character.age,assetRefs:character.assetRefs})), createdAt: session.created_at, updatedAt: session.updated_at, provider: this.provider.name }
    invariant(Buffer.byteLength(JSON.stringify(snapshot),'utf8')<=220_000,'SNAPSHOT_TOO_LARGE',409,'存档快照超出传输预算，请联系内容维护者检查该版本。')
    return snapshot
  }
  list(userId: string) {
    return { sessions: this.store.all<SessionRow>("SELECT * FROM sessions WHERE owner_id=? AND mode='story' ORDER BY updated_at DESC", userId).map(s => {
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
    let pack = this.content.get(body.packId)
    const requestedSeed=body.seed||id()
    let instance:GameInstance,assemblyFallback:AssemblyFallback|undefined
    try{instance=assemble(pack,requestedSeed)}catch(error){
      const safeRow=this.store.get<{manifest:string;checksum:string;status:string}>('SELECT manifest,checksum,status FROM packs WHERE id=? AND version=?',legacyPack.id,String(legacyPack.version))
      const expectedHash=hash(canonical(legacyPack))
      invariant(pack.occupationId===legacyPack.occupationId&&pack.version!==legacyPack.version&&safeRow?.status==='published'&&safeRow.checksum===expectedHash,'ASSEMBLY_UNAVAILABLE',409,'当前版本组局失败，尚无可用的同职业固定安全包。')
      const safePack=ContentPackSchema.parse(JSON.parse(safeRow.manifest))
      invariant(hash(canonical(safePack))===expectedHash&&checkAssets(safePack).ok,'ASSEMBLY_UNAVAILABLE',409,'固定安全包的版本或资源校验未通过，未创建存档。')
      instance=assembleWithFallback(pack,requestedSeed,safePack)
      assemblyFallback={fromPackVersion:pack.version,toPackVersion:safePack.version,reason:error instanceof Error?error.message.slice(0,300):'ASSEMBLY_GAP',requestedSeed}
      pack=safePack
    }
    const assembled = { ...instance, instanceId: id() }, state = startState(pack), sessionId = id(), branchId = id(), stamp = now()
    return this.store.transaction(() => {
      invariant(this.store.get('SELECT id FROM users WHERE id=?', userId), 'UNAUTHORIZED', 401, '请重新登录。')
      invariant(this.store.get<{n:number}>('SELECT COUNT(*) n FROM sessions WHERE owner_id=?',userId)!.n<50,'SESSION_LIMIT',409,'已保存50局，请先导出或管理已有记录。')
      this.store.run('INSERT INTO sessions (id,owner_id,title,pack_id,pack_version,current_branch_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', sessionId, userId, pack.title, pack.id, String(pack.version), branchId, stamp, stamp)
      this.store.run('INSERT INTO branches VALUES (?,?,NULL,0,0,?,?)', branchId, sessionId, JSON.stringify(state), stamp)
      this.insertInstance(sessionId, branchId, assembled)
      const occurrence = occurrenceFor(pack, assembled, state)
      const eventId = id(), messages = this.makeMessages([...nodeFor(pack, state).messages, ...(occurrence?.messages || [])], eventId, 1, stamp, 'group')
      this.store.run('INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)', eventId, sessionId, branchId, 1, 'session_started', 'system', 'group', null, JSON.stringify({ messages, revision: 0, versions: assembled,...(assemblyFallback?{assemblyFallback}:{}) }), JSON.stringify(state), stamp)
      if(assemblyFallback)this.store.audit(userId,'session.assembly_fallback',sessionId,{fromPackVersion:assemblyFallback.fromPackVersion,toPackVersion:assemblyFallback.toPackVersion,reason:assemblyFallback.reason})
      this.store.run('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?)', id(), sessionId, branchId, 1, 0, JSON.stringify(state), stamp)
      if (occurrence) this.store.run('INSERT INTO occurrences VALUES (?,?,?,?,?,?)', id(), assembled.instanceId, occurrence.id, String(occurrence.version), 'committed', 1)
      return this.get(userId,sessionId)
    })
  }
  private insertInstance(sessionId: string, branchId: string, instance: GameInstance) {
    this.store.run('INSERT INTO game_instances VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', instance.instanceId, sessionId, branchId, String(instance.packVersion), instance.datasetVersion, instance.contentBuildId, String(instance.profileVersion), instance.assetManifestVersion, instance.seed, instance.samplerVersion, JSON.stringify(instance.castMapping), JSON.stringify(instance.projectMapping), JSON.stringify(instance.eventPool), JSON.stringify(instance))
  }
  private makeMessages(messages: (NarrativeMessage | { speakerId: 'player'; text: string; expression: 'neutral' })[], eventId: string, seq: number, stamp: string, channel: GameMessage['channel'], recipientId?: string): GameMessage[] {
    return messages.map((m, index) => ({ ...m, id: `${eventId}:${index}`, eventSeq: seq, channel, ...(recipientId ? { recipientId } : {}), createdAt: stamp, sourceEventIds: [eventId] }))
  }
  async act(userId: string, sessionId: string, raw: unknown) {
    const input = ActionInputSchema.parse(raw)
    this.owned(userId, sessionId, 'story')
    const { prepared, turnId, lease, requestHash } = this.claimTurn<{ turnId: string; session: SessionDTO; messages: GameMessage[]; replayed: boolean }>(userId, sessionId, input)
    if ('receipt' in prepared && prepared.receipt) return { ...prepared.receipt, replayed: true }
    try {
      const branch = prepared.branch!, session = prepared.session!, pack = this.content.get(session.pack_id, session.pack_version)
      let state = WorldStateSchema.parse(JSON.parse(branch.state)), messages: (NarrativeMessage | { speakerId: 'player'; text: string; expression: 'neutral' })[] = [], effects: unknown[] = [], channel: GameMessage['channel'] = input.channel
      let usage: ProviderResult | undefined
      let intent:SupportedIntent|undefined
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
        intent=detectSupportedIntent(input.text!,choicesFor(pack,state).map(choice=>({id:choice.id,label:choice.label})))
        const speakerId = input.channel === 'private' ? input.recipientId! : 'lin'
        const visible = this.messages(this.lineage(sessionId, input.branchId))
        const context = buildRoleContext(pack, state, speakerId, visible, input.text!, choicesFor(pack, state).map(c => ({ id: c.id, label: c.label })))
        const lineage=this.lineage(sessionId,input.branchId)
        for(const fact of context.facts){
          fact.sourceEventIds=lineage.filter(event=>{const payload=JSON.parse(event.payload) as {effects?:{op:string;characterId?:string;factId?:string}[]};return payload.effects?.some(effect=>effect.op==='reveal'&&effect.characterId===speakerId&&effect.factId===fact.id)}).map(event=>event.id)
        }
        try { usage = await this.provider.generate(context) } catch (error) {
          if (error instanceof AppError) throw error
          throw new AppError('AI_UPSTREAM_FAILED', 503, '模型暂不可用，本回合未保存，请重试。')
        }
        messages = [{ speakerId: 'player', text: input.text!, expression: 'neutral' }, { speakerId, text: usage.text, expression: 'thinking' }]
      }
      return this.store.transaction(() => {
        const current = this.assertTurnCommit(userId, sessionId, input, turnId, lease)
        const eventSeq = this.store.get<{ n: number }>('SELECT COALESCE(MAX(event_seq),0)+1 n FROM event_logs WHERE session_id=?', sessionId)!.n
        const eventId = id(), stamp = now(), revision = current.revision + 1
        const committedMessages = this.makeMessages(messages, eventId, eventSeq, stamp, channel, input.recipientId)
        this.store.run('INSERT INTO event_logs VALUES (?,?,?,?,?,?,?,?,?,?,?)', eventId, sessionId, input.branchId, eventSeq, input.kind, userId, channel, input.recipientId || null, JSON.stringify({ messages: committedMessages, action: input, effects, revision,...(intent?{intent}:{}) }), JSON.stringify(state), stamp)
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
}
