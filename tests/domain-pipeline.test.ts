import { describe, expect, it } from 'vitest'
import { demoPack } from '../packages/content/seed'
import { mockCandidateGenerator, planBatch, runBatch, similarity, validateBatch } from '../packages/content/pipeline'

describe('离线合成候选批次', () => {
  it('按职业、槽位、版本与配置幂等规划', () => {
    const first = planBatch(demoPack); const second = planBatch(demoPack)
    expect(first.id).toBe(second.id)
    expect(first.items.map(item => item.key)).toEqual(second.items.map(item => item.key))
    expect(planBatch(demoPack, { variant: 'different' }).id).not.toBe(first.id)
  })
  it('预算不足在调用前暂停，可以追加预算续跑', async () => {
    let calls = 0
    const paused = await runBatch(planBatch(demoPack, { maxTokens: 0 }), demoPack, async (...args) => { calls++; return mockCandidateGenerator(...args) })
    expect(paused.status).toBe('paused'); expect(calls).toBe(0)
    paused.budget.maxTokens = 5000
    const complete = await runBatch(paused, demoPack)
    expect(complete.status).toBe('completed'); expect(complete.cursor).toBe(demoPack.events.length)
    expect(complete.budget.usedCostUSD).toBe(0)
    expect(complete.items.every(item => item.candidate?.contentStatus === 'draft')).toBe(true)
  })
  it('失败只重试失败项，不覆盖审核结果或多扣使用量', async () => {
    const batch = await runBatch(planBatch(demoPack), demoPack, async (source, context) => { if (source.id === demoPack.events[0]!.id) throw new Error('simulated failure'); return mockCandidateGenerator(source, context) })
    expect(batch.items[0]!.status).toBe('failed')
    batch.items[1]!.status = 'approved'
    const approved = structuredClone(batch.items[1])
    const resumedIds: string[] = []
    const resumed = await runBatch(batch, demoPack, async (source, context) => { resumedIds.push(source.id); return mockCandidateGenerator(source, context) })
    expect(resumedIds).toEqual([demoPack.events[0]!.id])
    expect(resumed.items[1]).toEqual(approved)
    const tokens = resumed.budget.usedTokens
    expect((await runBatch(resumed, demoPack)).budget.usedTokens).toBe(tokens)
  })
  it('结构与引用校验合格后仍需审核；重复候选被拒绝', async () => {
    const batch = await runBatch(planBatch(demoPack), demoPack)
    const checked = validateBatch(batch, demoPack)
    expect(checked.items.every(item => item.status === 'auto_checked')).toBe(true)
    expect(checked.items.every(item => item.candidate?.domainReviewStatus === 'pending')).toBe(true)
    batch.items[1]!.candidate!.messages = structuredClone(batch.items[0]!.candidate!.messages)
    expect(validateBatch(batch, demoPack).items[1]!.errors.join('')).toContain('重复')
    expect(similarity('你好，今天一起检查。', '你好 今天一起检查')).toBe(1)
  })
})
