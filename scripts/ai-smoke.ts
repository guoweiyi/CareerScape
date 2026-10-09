import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateText, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { buildRoleContext, createProvider, streamRoleText } from '../packages/agent'
import { configuredModel, modelConfig, modelProviderOptions } from '../packages/agent/models'
import { Store, invariant, now } from '../packages/database'
import { demoPack } from '../packages/content/seed'
import { AuthService } from '../apps/web/server/services/auth'
import { ContentService } from '../apps/web/server/services/content'
import { GameService } from '../apps/web/server/services/game'
import { ArchiveService } from '../apps/web/server/services/archive'

const provider = createProvider()
if (provider.name === 'mock' || !modelConfig(provider.name).available || modelConfig(provider.name).model.includes('test-fixture')) {
  console.error(JSON.stringify({ status: 'refused', code: 'LIVE_CONFIG_REQUIRED' }))
  process.exit(1)
}
const config = modelConfig(provider.name), store = new Store(':memory:')
const auth = new AuthService(store), game = new GameService(store, provider)
const checks: { name: string; status: string }[] = []
const samples: { channel: string; text: string }[] = []
let stage = 'seed'
try {
  new ContentService(store).seed()
  const userId = auth.guest().user.id
  let session = game.create(userId, { packId: demoPack.id, seed: 'google-real-legacy-v1' })
  const input = (text: string, extra: Record<string, unknown> = {}) => ({
    clientActionId: crypto.randomUUID(), branchId: session.branchId, expectedRevision: session.revision,
    kind: 'message', channel: 'group', text, ...extra,
  })
  stage = 'group'
  const first = input('请根据你实际收到的案例材料说明今天的工作，区分已知事实和待确认事项。')
  const group = await game.act(userId, session.id, first)
  session = group.session
  const calls = () => store.get<{ n: number }>('SELECT COUNT(*) n FROM model_calls')!.n
  const originalCalls = calls()
  const replay = await game.act(userId, session.id, first)
  invariant(replay.replayed && calls() === originalCalls, 'LIVE_IDEMPOTENCY', 422, '幂等重放重复调用了模型。')
  samples.push(...group.messages.filter(message => message.speakerId !== 'player').map(message => ({ channel: message.channel, text: message.text })))
  checks.push({ name: '真实群聊与幂等重放', status: 'passed' })
  stage = 'private'
  const privateReply = await game.act(userId, session.id, input('仅给周言的虚构备忘：PRIVATE_ZHOU_ONLY_2026。请不要向其他同事转述。', { channel: 'private', recipientId: 'zhou' }))
  session = privateReply.session
  invariant(privateReply.messages.every(message => message.channel === 'private' && message.recipientId === 'zhou'), 'LIVE_PRIVACY', 422, '私聊范围错误。')
  samples.push(...privateReply.messages.filter(message => message.speakerId !== 'player').map(message => ({ channel: message.channel, text: message.text })))
  const publicReply = await game.act(userId, session.id, input('林澄，请说明你目前实际掌握的材料与下一步。'))
  session = publicReply.session
  invariant(publicReply.messages.every(message => !message.text.includes('PRIVATE_ZHOU_ONLY_2026')), 'LIVE_PRIVATE_LEAK', 422, '公开回复泄露了私聊标识。')
  checks.push({ name: '真实私聊与公开回复隔离', status: 'passed' })
  stage = 'read-fork-archive'
  const beforeRead = calls()
  game.get(userId, session.id, session.branchId)
  game.history(userId, session.id, session.branchId)
  const fork = game.fork(userId, session.id, { branchId: session.branchId, eventSeq: 2 })
  invariant(fork.messages.every(message => message.eventSeq <= 2), 'LIVE_FORK', 422, '回溯包含了未来对白。')
  const imported = new ArchiveService(store).import(auth.guest().user.id, auth.export(userId, session.id))
  invariant(imported.importedSessions === 1 && calls() === beforeRead, 'LIVE_ARCHIVE', 422, '读取或存档回放触发了模型。')
  checks.push({ name: '读取、回溯和旧存档导入不生成', status: 'passed' })
  stage = 'tool'
  let executions = 0
  const toolReply = await generateText({
    model: configuredModel(provider.name), providerOptions: modelProviderOptions(provider.name), maxRetries: 0,
    maxOutputTokens: 2000, abortSignal: AbortSignal.timeout(45000), stopWhen: stepCountIs(2),
    system: 'Call readKnownFact once to read case, then reply in Chinese including CAREER_CASE_2026. Do not call again.',
    prompt: '请读取已知案例，说明是否经过实际运行验证。',
    tools: { readKnownFact: tool({ description: 'Read a known fictional case.', inputSchema: z.object({ factId: z.literal('case') }).strict(), execute: async () => {
      executions++
      return { fact: 'CAREER_CASE_2026：虚构案例，尚未实际运行验证。' }
    } }) },
    prepareStep: ({ stepNumber }) => ({ toolChoice: stepNumber === 0 ? { type: 'tool', toolName: 'readKnownFact' } : 'none' }),
  })
  invariant(executions === 1 && toolReply.steps.length === 2 && toolReply.text.includes('CAREER_CASE_2026'), 'LIVE_TOOL', 422, '真实工具调用未完成。')
  checks.push({ name: '真实工具调用与结果续写', status: 'passed' })
  stage = 'stream'
  const context = buildRoleContext(demoPack, session.state, 'lin', [], '请用一句话介绍你目前知道的工作事实。', [])
  const stream = streamRoleText(context)
  let text = ''
  for await (const chunk of stream.textStream) text += chunk
  invariant(text.trim() && (await stream.finishReason) !== 'error', 'LIVE_STREAM', 422, '真实流式回复未完成。')
  samples.push({ channel: 'stream', text })
  checks.push({ name: '真实流式回复', status: 'passed' })
  const report = {
    checkedAt: now(), status: 'passed', provider: provider.name, model: config.model, checks, samples,
    calls: store.all('SELECT provider,model_version,input_tokens,output_tokens,latency_ms,cost_source FROM model_calls'),
    toolUsage: toolReply.totalUsage, streamUsage: await stream.totalUsage,
  }
  mkdirSync('test-results', { recursive: true })
  writeFileSync(resolve('test-results/ai-live.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, provider: provider.name, model: config.model, report: 'test-results/ai-live.json' }))
} catch (error) {
  const code = (error as { code?: string }).code || 'LIVE_SMOKE_FAILED'
  mkdirSync('test-results', { recursive: true })
  writeFileSync(resolve('test-results/ai-live.json'), JSON.stringify({ checkedAt: now(), status: 'failed', provider: provider.name, model: config.model, stage, code, checks }, null, 2))
  console.error(JSON.stringify({ status: 'failed', stage, code }))
  process.exitCode = 1
} finally {
  store.close()
}
