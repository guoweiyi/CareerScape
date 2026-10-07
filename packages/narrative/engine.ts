import { ContentPackSchema, EffectSchema, WorldStateSchema, type Choice, type Condition, type ContentPack, type Effect, type EventTemplate, type GameInstance, type NarrativeMessage, type StoryNode, type WorldState } from '../contracts'

export class NarrativeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'NarrativeError' }
}
const clone = <T>(value: T): T => structuredClone(value)
export function conditionsMatch(conditions: Condition[], state: WorldState): boolean {
  return conditions.every(condition => {
    switch (condition.op) {
      case 'flag': return state.flags[condition.key] === condition.equals
      case 'time_before': return state.minute < condition.minute
      case 'task_is': return state.taskStatus === condition.value
      case 'knows': return state.knowledge[condition.characterId].includes(condition.factId)
    }
  })
}
export function applyEffects(state: WorldState, effects: Effect[]): WorldState {
  const next = clone(WorldStateSchema.parse(state))
  for (const candidate of effects) {
    const effect = EffectSchema.parse(candidate)
    switch (effect.op) {
      case 'set_flag': next.flags[effect.key] = effect.value; break
      case 'advance_time': next.minute = Math.min(180, next.minute + effect.minutes); break
      case 'set_task': next.taskStatus = effect.value; break
      case 'reveal': if (!next.knowledge[effect.characterId].includes(effect.factId)) next.knowledge[effect.characterId].push(effect.factId); break
      case 'relation': if (!next.relations[effect.characterId].includes(effect.label)) next.relations[effect.characterId].push(effect.label); break
      case 'resolve': next.unresolved = next.unresolved.filter(issue => issue !== effect.issue); break
    }
  }
  return next
}
export function startState(pack: ContentPack): WorldState {
  const knowledge = { lin: [] as string[], zhou: [] as string[], xu: [] as string[] }
  for (const character of pack.characters) knowledge[character.id] = [...character.initialKnowledge]
  return WorldStateSchema.parse({ nodeId: pack.startNodeId, minute: 0, flags: { helpAsked: false, bugReproduced: false, verified: false, scopeReduced: false, handoffReady: false, askedProduct: false, roleSwitched: false, reported: false }, knowledge, relations: { lin: [], zhou: [], xu: [] }, unresolved: ['重复报名待确认'], taskStatus: 'orientation', perspective: 'qa' })
}
export function nodeFor(pack: ContentPack, state: WorldState): StoryNode {
  const node = pack.nodes.find(item => item.nodeId === state.nodeId)
  if (!node) throw new NarrativeError('NODE_NOT_FOUND', '冻结包中找不到当前节点，请以只读方式恢复存档')
  return clone(node)
}
export function choicesFor(pack: ContentPack, state: WorldState): Choice[] {
  return nodeFor(pack, state).choices.filter(choice => conditionsMatch(choice.conditions, state)).map(clone)
}
const globalChoice = (id: string, state: WorldState): Choice | undefined => {
  const common = { id, description: '', targetNodeId: state.nodeId, conditions: [], effects: [] as Effect[], messages: [] as NarrativeMessage[] }
  if (id === 'leave') return { ...common, label: '整理当前状态后下班', targetNodeId: 'ending-handoff', effects: [{ op: 'set_flag', key: 'handoffReady', value: true }, { op: 'set_task', value: 'deferred' }], messages: [{ speakerId: 'lin', text: '可以结束今天的体验。我们按当前真实状态留下交接记录，未验证的事项不会写成已完成。', expression: 'relaxed' }] }
  if (id === 'help') return { ...common, label: '我需要帮助', effects: [{ op: 'set_flag', key: 'helpAsked', value: true }], messages: [{ speakerId: 'lin', text: '可以。你可以先描述看到了什么，不需要用术语；我可以一起核对材料。也可以选择交接，不必把所有事情独自做完。', expression: 'relaxed' }] }
  if (id === 'switch_role') return { ...common, label: state.perspective === 'qa' ? '看看产品职责的一小段' : '回到测试职责', effects: [{ op: 'set_flag', key: 'roleSwitched', value: true }], messages: state.perspective === 'qa' ? [
    { speakerId: 'narrator', text: '职责短片段 · 你暂时站在产品负责人视角。你拿到一份测试新人原本没有的材料：介绍页与报名入口可以分开发布，对外的开放时间还没有最终确认。', expression: 'neutral' },
    { speakerId: 'xu', text: '如果测试给出具体影响，我可以协商交付范围。我的工作是确认承诺、说明影响并承担决定；我不能把“想按时发布”写成“测试已经通过”。', expression: 'thinking' },
    { speakerId: 'narrator', text: '这是已发布的教学视角片段，不会把其他人的私聊交给你，也不会让 NPC 自动知道这段旁白。可以随时回到测试视角。', expression: 'neutral' },
  ] : [{ speakerId: 'narrator', text: '你回到测试新人职责。刚才的产品材料是对同一个项目的另一种观察；当前任务进度保持原样。', expression: 'neutral' }] }
  return undefined
}
export function applyChoice(pack: ContentPack, state: WorldState, choiceId: string): { state: WorldState; node: StoryNode; messages: NarrativeMessage[]; effects: Effect[]; choice: Choice } {
  if (state.endingId) throw new NarrativeError('STORY_ENDED', '这条分支已经结束，可从历史节点开启新分支')
  const choice = choicesFor(pack, state).find(item => item.id === choiceId) ?? globalChoice(choiceId, state)
  if (!choice) throw new NarrativeError('CHOICE_UNAVAILABLE', '这个行动不在当前可用范围中')
  const next = applyEffects(state, choice.effects)
  next.nodeId = choice.targetNodeId
  if (choiceId === 'switch_role') next.perspective = state.perspective === 'qa' ? 'product' : 'qa'
  const node = nodeFor(pack, next)
  const changedNode = next.nodeId !== state.nodeId
  if (changedNode) Object.assign(next, applyEffects(next, node.effects))
  if (node.metadata.endingId) next.endingId = node.metadata.endingId
  return { state: WorldStateSchema.parse(next), node, messages: [...clone(choice.messages), ...(changedNode ? clone(node.messages) : [])], effects: clone([...choice.effects, ...(changedNode ? node.effects : [])]), choice }
}

/** Stable non-cryptographic sampler only. It is not a security token or content integrity hash. */
function seededRandom(seed: string): () => number {
  let value = 2166136261
  for (let index = 0; index < seed.length; index++) value = Math.imul(value ^ seed.charCodeAt(index), 16777619)
  return () => { value += 0x6D2B79F5; let x = value; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296 }
}
export function eligibleEventIds(pack: ContentPack, state: WorldState, options: { cast?: string[]; occurred?: string[]; turn?: number; occurrenceTurns?: Record<string, number>; slot?: string } = {}): string[] {
  const cast = new Set(options.cast ?? pack.characters.map(character => character.id))
  const happened = pack.events.filter(event => options.occurred?.includes(event.id))
  return pack.events.filter(event => event.contentStatus === 'published' && event.domainReviewStatus !== 'rejected' && event.roles.every(role => cast.has(role)) && (!options.slot || event.slot === options.slot) && conditionsMatch(event.conditions, state) && !options.occurred?.includes(event.id) && (!event.mutexGroup || !happened.some(other => other.mutexGroup === event.mutexGroup)) && (options.occurrenceTurns?.[event.id] === undefined || (options.turn ?? 0) - (options.occurrenceTurns[event.id] ?? 0) > event.cooldownTurns)).map(event => event.id)
}
export function validatePack(input: unknown): { valid: boolean; issues: string[] } {
  const parsed = ContentPackSchema.safeParse(input)
  if (!parsed.success) return { valid: false, issues: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) }
  const pack = parsed.data
  const issues: string[] = []
  const unique = (values: string[], kind: string) => { if (new Set(values).size !== values.length) issues.push(`${kind}包含重复 ID`) }
  unique(pack.nodes.map(node => node.nodeId), '节点'); unique(pack.characters.map(character => character.id), '人物'); unique(pack.events.map(event => event.id), '事件'); unique(pack.facts.map(fact => fact.id), '事实'); unique(pack.sources.map(source => source.id), '来源')
  const nodeIds = new Set(pack.nodes.map(node => node.nodeId)); const factIds = new Set(pack.facts.map(fact => fact.id)); const sourceIds = new Set(pack.sources.map(source => source.id)); const assets = new Set(pack.assetRefs)
  if (!nodeIds.has(pack.startNodeId)) issues.push('缺少起点')
  if (pack.releasePolicy === 'industry' && pack.domainReviewStatus !== 'verified') issues.push('正式行业包必须完成行业核验')
  if (pack.domainReviewStatus === 'rejected') issues.push('行业审核拒绝的包不得入局')
  for (const character of pack.characters) {
    for (const fact of character.initialKnowledge) if (!factIds.has(fact)) issues.push(`${character.id}引用未知事实 ${fact}`)
    for (const asset of character.assetRefs) if (!assets.has(asset)) issues.push(`${character.id}引用未知资产 ${asset}`)
  }
  for (const fact of pack.facts) if (!sourceIds.has(fact.sourceId)) issues.push(`未知来源 ${fact.sourceId}`)
  for (const node of pack.nodes) {
    if (node.packId !== pack.id || node.packVersion !== pack.version) issues.push(`${node.nodeId}包版本不匹配`)
    if (!node.metadata.endingId && !node.choices.length) issues.push(`${node.nodeId}是死路`)
    unique(node.choices.map(choice => choice.id), `${node.nodeId}选项`)
    for (const asset of node.assetRefs) if (!assets.has(asset)) issues.push(`${node.nodeId}引用未知资产 ${asset}`)
    for (const choice of node.choices) {
      if (!nodeIds.has(choice.targetNodeId)) issues.push(`未知目标 ${choice.targetNodeId}`)
      if (!node.outgoingEdges.some(edge => edge.to === choice.targetNodeId && edge.choiceId === choice.id)) issues.push(`选项 ${choice.id}缺少作者图边`)
      for (const effect of choice.effects) if (effect.op === 'reveal' && !factIds.has(effect.factId)) issues.push(`未知事实 ${effect.factId}`)
    }
  }
  for (const event of pack.events) {
    for (const fact of [...event.sourceFactIds, ...event.revealFactIds]) if (!factIds.has(fact)) issues.push(`事件 ${event.id}引用未知事实 ${fact}`)
    if (!event.roles.every(role => pack.characters.some(character => character.id === role))) issues.push(`事件 ${event.id}角色缺席`)
  }
  const visiting = new Set<string>(); const visited = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id)) { issues.push(`作者图存在循环 ${id}`); return }
    if (visited.has(id)) return
    visiting.add(id)
    const current = pack.nodes.find(node => node.nodeId === id)
    for (const edge of current?.outgoingEdges ?? []) visit(edge.to)
    visiting.delete(id); visited.add(id)
  }
  visit(pack.startNodeId)
  if (pack.nodes.some(node => !visited.has(node.nodeId))) issues.push('存在不可达节点')
  if (!issues.length) {
    const endings = new Set<string>(); const seen = new Set<string>(); const queue = [startState(pack)]; let iterations = 0
    while (queue.length && iterations++ < 5000) {
      const state = queue.shift()!
      const signature = JSON.stringify(state)
      if (seen.has(signature)) continue
      seen.add(signature)
      if (state.endingId) { endings.add(state.endingId); continue }
      const choices = choicesFor(pack, state)
      if (!choices.length) issues.push(`状态 ${state.nodeId}无可用行动`)
      for (const choice of choices) queue.push(applyChoice(pack, state, choice.id).state)
    }
    if (queue.length) issues.push('可达性校验超出受限状态预算')
    if (endings.size < 3) issues.push('至少三条可完成路径必须可达')
  }
  return { valid: !issues.length, issues }
}
export function assemble(pack: ContentPack, seed: string | number): GameInstance {
  const validation = validatePack(pack)
  if (!validation.valid) throw new NarrativeError('INVALID_PACK', validation.issues.join('；'))
  if (pack.contentStatus !== 'published') throw new NarrativeError('UNPUBLISHED_PACK', '草稿或撤回内容不能用于正式开局')
  const random = seededRandom(`${pack.id}:${pack.version}:${pack.samplerVersion}:${seed}`)
  const state = startState(pack)
  const eligible = new Set(eligibleEventIds(pack, state))
  const pool = pack.events.filter(event => eligible.has(event.id))
  const slotMapping: Record<string, string> = {}; const chosenGroups = new Set<string>()
  for (const slot of ['arrival', 'briefing', 'triage', 'work', 'decision', 'ending']) {
    const candidates = pool.filter(event => event.slot === slot && (!event.mutexGroup || !chosenGroups.has(event.mutexGroup)))
    if (!candidates.length) throw new NarrativeError('ASSEMBLY_GAP', `槽位 ${slot}没有相容的已发布候选`)
    let draw = random() * candidates.reduce((sum, event) => sum + event.weight, 0)
    let selected: EventTemplate = candidates[candidates.length - 1]!
    for (const event of candidates) { draw -= event.weight; if (draw <= 0) { selected = event; break } }
    slotMapping[slot] = selected.id
    if (selected.mutexGroup) chosenGroups.add(selected.mutexGroup)
  }
  return { instanceId: `instance-${pack.id}-${pack.version}-${String(seed).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'seed'}`, packId: pack.id, packVersion: pack.version, datasetVersion: pack.datasetVersion, contentBuildId: pack.contentBuildId, profileVersion: pack.profileVersion, assetManifestVersion: pack.assetManifestVersion, schemaVersion: 1, samplerVersion: pack.samplerVersion, seed: String(seed), castMapping: { mentor: 'lin', developer: 'zhou', product: 'xu' }, projectMapping: pack.project.id, eventPool: pool.map(event => event.id), slotMapping, fallback: false }
}
/** Fallback is allowed only while creating a new instance, never after a player's first event. */
export function assembleWithFallback(pack: ContentPack, seed: string | number, fixedSafePack?: ContentPack): GameInstance {
  try { return assemble(pack, seed) } catch (error) {
    if (!fixedSafePack || fixedSafePack.occupationId !== pack.occupationId) throw error
    return { ...assemble(fixedSafePack, 'fixed-safe-v1'), fallback: true }
  }
}
export function occurrenceFor(pack: ContentPack, instance: GameInstance, state: WorldState): EventTemplate | undefined {
  if (instance.packId !== pack.id || instance.packVersion !== pack.version || instance.contentBuildId !== pack.contentBuildId) throw new NarrativeError('VERSION_MISMATCH', '存档内容版本不一致')
  const slot = state.endingId ? 'ending' : state.nodeId
  const id = instance.slotMapping[slot]
  return pack.events.find(event => event.id === id && instance.eventPool.includes(id) && event.contentStatus === 'published' && conditionsMatch(event.conditions, state))
}
