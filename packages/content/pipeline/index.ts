import { createHash } from 'node:crypto'
import { z } from 'zod'
import { EventTemplateSchema, type ContentPack, type EventTemplate } from '../../contracts'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const BatchSchema = z.object({
  id: z.string(), profileId: z.string(), profileVersion: z.number(), configHash: z.string(), promptVersion: z.string(), modelVersion: z.literal('mock-synthetic-v1'), provider: z.literal('mock'),
  cursor: z.number().int().nonnegative(), status: z.enum(['planned', 'running', 'paused', 'completed']), quota: z.number().int().positive(), createdAt: z.string().datetime(),
  budget: z.object({ maxTokens: z.number().int().nonnegative(), maxCostUSD: z.number().nonnegative(), usedTokens: z.number().int().nonnegative(), usedCostUSD: z.number().nonnegative(), estimateSource: z.literal('mock-character-count; no paid provider call') }).strict(),
  items: z.array(z.object({ key: z.string(), sourceTemplateId: z.string(), slot: z.string(), status: z.enum(['planned', 'generated', 'failed', 'auto_checked', 'approved', 'published']), retries: z.number().int().nonnegative(), estimatedTokens: z.number().int().positive(), hash: z.string().optional(), candidate: EventTemplateSchema.optional(), errors: z.array(z.string()) }).strict()),
}).strict()
export type ContentBatch = z.infer<typeof BatchSchema>

export function planBatch(pack: ContentPack, options: { maxTokens?: number; maxCostUSD?: number; variant?: string } = {}): ContentBatch {
  const configHash = digest(JSON.stringify({ profile: pack.profile.id, version: pack.profileVersion, prompt: pack.promptVersion, variant: options.variant ?? 'seed-demo', sourceIds: pack.events.map(event => `${event.id}@${event.version}`) }))
  const items = pack.events.map(event => ({ key: `${pack.profile.id}@${pack.profileVersion}:event:${event.slot}:${event.id}:${configHash.slice(0, 12)}`, sourceTemplateId: event.id, slot: event.slot, status: 'planned' as const, retries: 0, estimatedTokens: 180, errors: [] }))
  return { id: `batch-${configHash.slice(0, 20)}`, profileId: pack.profile.id, profileVersion: pack.profileVersion, configHash, promptVersion: pack.promptVersion, modelVersion: 'mock-synthetic-v1', provider: 'mock', cursor: 0, quota: items.length, status: 'planned', createdAt: new Date().toISOString(), budget: { maxTokens: options.maxTokens ?? 5000, maxCostUSD: options.maxCostUSD ?? 0, usedTokens: 0, usedCostUSD: 0, estimateSource: 'mock-character-count; no paid provider call' }, items }
}
export type CandidateGenerator = (source: EventTemplate, batch: ContentBatch) => Promise<{ candidate: unknown; inputTokens: number; outputTokens: number; costUSD: number }>
export const mockCandidateGenerator: CandidateGenerator = async (source, batch) => {
  const candidate = { ...structuredClone(source), id: `${source.id}-candidate-${batch.configHash.slice(0, 8)}`, batchId: batch.id, contentStatus: 'draft', domainReviewStatus: 'pending' }
  return { candidate, inputTokens: 40, outputTokens: Math.ceil(source.messages.map(message => message.text).join('').length / 2), costUSD: 0 }
}
export async function runBatch(input: ContentBatch, pack: ContentPack, generate: CandidateGenerator = mockCandidateGenerator): Promise<ContentBatch> {
  const batch = BatchSchema.parse(structuredClone(input)); batch.status = 'running'
  for (const item of batch.items) {
    if (!['planned', 'failed'].includes(item.status) || item.retries >= 3) continue
    if (batch.budget.usedTokens + item.estimatedTokens > batch.budget.maxTokens || batch.budget.usedCostUSD > batch.budget.maxCostUSD) { batch.status = 'paused'; break }
    item.retries++
    try {
      const source = pack.events.find(event => event.id === item.sourceTemplateId)
      if (!source) throw new Error('源模板已不存在，请新建批次而不是改写旧批次')
      const result = await generate(source, batch)
      if (![result.inputTokens, result.outputTokens, result.costUSD].every(value => Number.isFinite(value) && value >= 0)) throw new Error('生成器使用量无效')
      batch.budget.usedTokens += result.inputTokens + result.outputTokens; batch.budget.usedCostUSD += result.costUSD
      const candidate = EventTemplateSchema.parse(result.candidate)
      if (candidate.contentStatus !== 'draft' || candidate.profileId !== pack.profile.id || candidate.profileVersion !== pack.profileVersion || candidate.batchId !== batch.id) throw new Error('候选身份或草稿状态不合法')
      item.candidate = candidate; item.hash = digest(JSON.stringify(candidate)); item.status = 'generated'; item.errors = []
      if (batch.budget.usedTokens > batch.budget.maxTokens || batch.budget.usedCostUSD > batch.budget.maxCostUSD) { batch.status = 'paused'; item.errors = ['实际使用量超过预算，批次已暂停']; break }
    } catch (error) { item.status = 'failed'; item.errors = [error instanceof Error ? error.message : 'unknown generation error'] }
  }
  batch.cursor = batch.items.filter(item => !['planned', 'failed'].includes(item.status)).length
  if (batch.status !== 'paused') batch.status = batch.items.some(item => ['planned', 'failed'].includes(item.status)) ? 'paused' : 'completed'
  return batch
}
function bigrams(text: string): Set<string> { const normalized = text.replace(/[\s\p{P}\p{S}]/gu, ''); return new Set(Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) => normalized.slice(index, index + 2))) }
export function similarity(left: string, right: string): number {
  const a = bigrams(left); const b = bigrams(right); const union = new Set([...a, ...b]); return union.size ? [...a].filter(value => b.has(value)).length / union.size : 1
}
export function validateBatch(input: ContentBatch, pack: ContentPack): ContentBatch {
  const batch = BatchSchema.parse(structuredClone(input)); const candidates: { text: string; hash: string; id: string }[] = []
  for (const item of batch.items) {
    if (['approved', 'published'].includes(item.status) || !item.candidate) continue
    const candidate = item.candidate; const errors: string[] = []
    if (!candidate.roles.every(role => pack.characters.some(character => character.id === role))) errors.push('角色槽位不相容')
    if (!candidate.sourceFactIds.every(id => pack.facts.some(fact => fact.id === id))) errors.push('事实引用缺失')
    if (!candidate.actions.every(id => id === 'leave' || pack.nodes.some(node => node.choices.some(choice => choice.id === id)))) errors.push('动作引用缺失')
    const text = candidate.messages.map(message => message.text).join(''); const contentHash = digest(text)
    if (candidates.some(other => other.hash === contentHash || similarity(other.text, text) >= 0.86)) errors.push('批内文本重复或近似重复，需人工确认')
    candidates.push({ text, hash: contentHash, id: candidate.id })
    item.errors = errors
    item.status = errors.length ? 'failed' : 'auto_checked'
    if (!errors.length) candidate.contentStatus = 'auto_checked'
    item.hash = digest(JSON.stringify(candidate))
  }
  return batch
}
