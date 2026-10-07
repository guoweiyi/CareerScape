import { describe, expect, it } from 'vitest'
import { demoPack } from '../packages/content/seed'
import { ActionInputSchema, ConditionSchema, ContentPackSchema, EffectSchema } from '../packages/contracts'
import { applyChoice, applyEffects, assemble, assembleWithFallback, choicesFor, eligibleEventIds, occurrenceFor, startState, validatePack } from '../packages/narrative/engine'

describe('首包与受约束叙事', () => {
  it('首包是不可变的、完整的原创合成候选', () => {
    expect(ContentPackSchema.safeParse(demoPack).success).toBe(true)
    expect(validatePack(demoPack)).toEqual({ valid: true, issues: [] })
    expect(demoPack.events.length).toBeGreaterThanOrEqual(12)
    expect(demoPack.nodes).toHaveLength(8)
    expect(Object.isFrozen(demoPack.characters[0])).toBe(true)
    expect(demoPack.domainReviewStatus).toBe('pending')
  })
  it.each([
    ['verified', ['arrive_begin', 'brief_expected', 'triage_verify', 'work_verify', 'finish_verified']],
    ['scope', ['arrive_help', 'brief_product', 'triage_scope', 'work_scope', 'finish_scope']],
    ['handoff', ['arrive_begin', 'brief_help', 'triage_handoff', 'work_handoff', 'finish_handoff']],
  ] as const)('完整路线 %s 可达且不超一小时', (ending, route) => {
    let state = startState(demoPack)
    for (const id of route) { const previous = structuredClone(state); const result = applyChoice(demoPack, state, id); expect(state).toEqual(previous); expect(result.messages.length).toBeGreaterThan(0); state = result.state }
    expect(state.endingId).toBe(ending)
    expect(state.minute).toBeLessThanOrEqual(60)
    expect(choicesFor(demoPack, state)).toEqual([])
  })
  it('每个非终点均可求助和交接退出；不增加顺从分数', () => {
    for (const node of demoPack.nodes.filter(item => item.nodeType !== 'ending')) {
      const state = { ...startState(demoPack), nodeId: node.nodeId }
      const help = applyChoice(demoPack, state, 'help')
      expect(help.state.flags.helpAsked).toBe(true)
      expect(help.state.nodeId).toBe(node.nodeId)
      expect(applyChoice(demoPack, help.state, 'leave').state.endingId).toBe('handoff')
      expect(help.state).not.toHaveProperty('score')
    }
  })
  it('缺少验证前提不能跳至验证结局', () => {
    const state = { ...startState(demoPack), nodeId: 'decision' }
    expect(choicesFor(demoPack, state).map(choice => choice.id)).toEqual(['finish_handoff'])
    expect(() => applyChoice(demoPack, state, 'finish_verified')).toThrow('当前可用范围')
    expect(() => applyEffects(state, [{ op: 'eval', code: '1+1' }] as never)).toThrow()
  })
  it('提出缩小范围不等于已确认，交接后不能把协商建议写成完成', () => {
    let state = startState(demoPack)
    for (const id of ['arrive_begin', 'brief_expected', 'triage_scope', 'work_handoff']) state = applyChoice(demoPack, state, id).state
    expect(state.flags.askedProduct).toBe(true)
    expect(state.flags.scopeReduced).toBe(false)
    expect(choicesFor(demoPack, state).map(choice => choice.id)).toEqual(['finish_handoff'])
  })
  it('职责切换揭示另一职责材料，但不把旁白写入 NPC 知识', () => {
    const state = startState(demoPack)
    const result = applyChoice(demoPack, state, 'switch_role')
    expect(result.state.perspective).toBe('product')
    expect(result.messages.some(message => message.text.includes('原本没有的材料'))).toBe(true)
    expect(result.state.knowledge).toEqual(state.knowledge)
    expect(result.state.knowledge.lin).not.toContain('product-note')
    expect(applyChoice(demoPack, result.state, 'switch_role').state.perspective).toBe('qa')
  })
  it('拒绝任意脚本、未知 DSL、动作身份和额外字段', () => {
    expect(ConditionSchema.safeParse({ op: 'javascript', expression: 'true' }).success).toBe(false)
    expect(EffectSchema.safeParse({ op: 'set_flag', key: 'admin', value: true }).success).toBe(false)
    expect(ActionInputSchema.safeParse({ clientActionId: '12345678', expectedRevision: 0, branchId: 'b', kind: 'message', text: '你好', channel: 'group', userId: 'victim' }).success).toBe(false)
  })
  it('引用缺失、循环、不可达路径和行业未审核阻止发布', () => {
    const cycle = structuredClone(demoPack); cycle.nodes[0]!.outgoingEdges.push({ to: 'arrival', choiceId: 'bad', conditions: [] })
    expect(validatePack(cycle).issues.some(issue => issue.includes('循环'))).toBe(true)
    const invalid = structuredClone(demoPack); invalid.characters[0]!.assetRefs[0] = 'unknown'
    expect(validatePack(invalid).valid).toBe(false)
    const industry = { ...demoPack, releasePolicy: 'industry' }
    expect(validatePack(industry).issues.some(issue => issue.includes('行业核验'))).toBe(true)
  })
})

describe('版本、事件条件和组局', () => {
  it('同版本与 seed 复现组局，不同 seed 只改变相容事件', () => {
    expect(assemble(demoPack, 'seed-1')).toEqual(assemble(demoPack, 'seed-1'))
    const signatures = new Set(Array.from({ length: 12 }, (_, index) => JSON.stringify(assemble(demoPack, index).slotMapping)))
    expect(signatures.size).toBeGreaterThan(1)
    const instance = assemble(demoPack, 'a')
    expect(Object.keys(instance.slotMapping)).toHaveLength(6)
    expect(occurrenceFor(demoPack, instance, startState(demoPack))?.slot).toBe('arrival')
    const old = structuredClone(instance); const changed = structuredClone(demoPack); changed.contentBuildId = 'new'
    expect(() => occurrenceFor(changed, instance, startState(demoPack))).toThrow('版本不一致')
    expect(instance).toEqual(old)
  })
  it('草稿、缺席人物、未满足前提、互斥和冷却不进入候选', () => {
    const state = startState(demoPack)
    expect(eligibleEventIds(demoPack, state)).not.toContain('work-verified-detail')
    expect(eligibleEventIds(demoPack, state, { cast: ['lin', 'xu'] })).not.toContain('work-context')
    expect(eligibleEventIds(demoPack, state, { occurred: ['daily-window'] })).not.toContain('daily-checklist')
    const pack = structuredClone(demoPack); pack.events[0]!.contentStatus = 'draft'; pack.events[1]!.cooldownTurns = 2
    expect(eligibleEventIds(pack, state)).not.toContain('daily-window')
    expect(eligibleEventIds(pack, state, { turn: 3, occurrenceTurns: { 'daily-checklist': 2 } })).not.toContain('daily-checklist')
    expect(() => assemble({ ...pack, contentStatus: 'draft' }, 'x')).toThrow('草稿')
  })
  it('新建失败可回退同岗位固定包；当前局无候选仍可退出', () => {
    const bad = structuredClone(demoPack); bad.events.forEach(event => { event.contentStatus = 'draft' })
    expect(() => assemble(bad, 'x')).toThrow('没有相容')
    expect(assembleWithFallback(bad, 'x', demoPack).fallback).toBe(true)
    const state = startState(demoPack)
    expect(eligibleEventIds(bad, state)).toEqual([])
    expect(applyChoice(bad, state, 'leave').state.endingId).toBe('handoff')
  })
})
