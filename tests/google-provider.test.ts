import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { GoogleGalgameProvider, createGalgameProvider, galgameConfig, type GalgameModelUsage } from '../packages/agent/galgame'
import { GoogleProvider, createProvider, buildRoleContext } from '../packages/agent'
import { modelConfig } from '../packages/agent/models'
import { GalgameNpcResponseSchema } from '../packages/contracts/galgame'
import { demoPack } from '../packages/content/seed'
import { startState } from '../packages/narrative/engine'
import { Store } from '../packages/database'
import { AuthService } from '../apps/web/server/services/auth'
import { GameService } from '../apps/web/server/services/game'
import { ContentService } from '../apps/web/server/services/content'

const servers: Server[] = []
const stores: Store[] = []
async function configure(server: Server) {
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  vi.stubEnv('AI_PROVIDER', 'google')
  vi.stubEnv('GALGAME_ENABLED', '1')
  vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-google-secret')
  vi.stubEnv('GOOGLE_MODEL', 'gemini-3-flash-test-fixture')
  vi.stubEnv('GOOGLE_BASE_URL', `http://127.0.0.1:${port}`)
}
afterEach(async () => {
  vi.unstubAllEnvs()
  stores.splice(0).forEach(store => store.close())
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})
const request = { role: 'npc' as const, context: { facts: [{ id: 'case', text: '虚构案例，尚未实际测试。' }], isReviewer: false } }
function reply(text: string, finishReason = 'STOP') {
  return JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason }], usageMetadata: { promptTokenCount: 17, candidatesTokenCount: 23, totalTokenCount: 40 } })
}
describe('Vercel Google provider 的真实 HTTP 协议', () => {
  it('使用Google原生路径、鉴权和最低推理等级，解析现有Galgame合约', async () => {
    let captured: { path?: string; key?: string; bearer?: string; body?: Record<string, unknown> } = {}
    await configure(createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += String(chunk)
      captured = { path: req.url, key: req.headers['x-goog-api-key'] as string, bearer: req.headers.authorization, body: JSON.parse(body) }
      res.setHeader('content-type', 'application/json')
      res.end(reply(JSON.stringify({ text: '先澄清虚构材料，尚未实际测试。', expression: 'thinking', factIds: ['case'], review: null })))
    }))
    const usage: GalgameModelUsage[] = []
    const provider = createGalgameProvider()
    expect(provider).toBeInstanceOf(GoogleGalgameProvider)
    expect(createProvider()).toBeInstanceOf(GoogleProvider)
    const result = await provider.generate(GalgameNpcResponseSchema, request, AbortSignal.timeout(3000), call => usage.push(call))
    expect(result.factIds).toEqual(['case'])
    expect(captured.path).toBe('/v1beta/models/gemini-3-flash-test-fixture:generateContent')
    expect(captured.key).toBe('test-google-secret')
    expect(captured.bearer).toBeUndefined()
    expect(captured.body).toMatchObject({ generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' } } })
    expect(JSON.stringify(captured.body)).toContain('outputSchema')
    expect(usage).toMatchObject([{ status: 'succeeded', inputTokens: 17, outputTokens: 23 }])
  })
  it.each(['invalid', 'truncated'] as const)('%s输出不提交，保留真实报告的用量', async mode => {
    await configure(createServer((_req, res) => {
      res.setHeader('content-type', 'application/json')
      res.end(reply('{"text":', mode === 'truncated' ? 'MAX_TOKENS' : 'STOP'))
    }))
    const usage: GalgameModelUsage[] = []
    await expect(new GoogleGalgameProvider().generate(GalgameNpcResponseSchema, request, AbortSignal.timeout(3000), call => usage.push(call)))
      .rejects.toMatchObject({ code: mode === 'truncated' ? 'AI_OUTPUT_TRUNCATED' : 'AI_INVALID_OUTPUT' })
    expect(usage).toMatchObject([{ status: 'failed', inputTokens: 17, outputTokens: 23 }])
  })
  it('上游错误不泄露密钥和正文；未知用量保留null', async () => {
    await configure(createServer((_req, res) => { res.writeHead(503); res.end('upstream-secret-body') }))
    const usage: GalgameModelUsage[] = []
    await expect(new GoogleGalgameProvider().generate(GalgameNpcResponseSchema, request, AbortSignal.timeout(3000), call => usage.push(call)))
      .rejects.toMatchObject({ code: 'AI_UPSTREAM_FAILED', message: '模型服务暂不可用，本回合未保存，请稍后重试。' })
    expect(usage).toMatchObject([{ failureCode: 'AI_UPSTREAM_FAILED', inputTokens: null, outputTokens: null }])
  })
  it('超时中止Google请求', async () => {
    await configure(createServer(() => {}))
    await expect(new GoogleGalgameProvider().generate(GalgameNpcResponseSchema, request, AbortSignal.timeout(50), () => {}))
      .rejects.toMatchObject({ code: 'AI_TIMEOUT' })
  })
  it('旧剧情工具执行后携带Google原生functionResponse继续生成', async () => {
    const context = buildRoleContext(demoPack, startState(demoPack), 'lin', [], '请读取已知材料。', [])
    const factId = context.facts[0]!.id
    let calls = 0
    let declarations: unknown
    let responseParts: unknown[] = []
    await configure(createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += String(chunk)
      const input = JSON.parse(body)
      calls++
      res.setHeader('content-type', 'application/json')
      if (calls === 1) {
        declarations = input.tools[0].functionDeclarations
        res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'readKnownFact', args: { factId } }, thoughtSignature: 'dGVzdC1zaWduYXR1cmU=' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10, totalTokenCount: 20 } }))
      } else {
        responseParts = input.contents.flatMap((content: { parts: unknown[] }) => content.parts)
        res.end(reply('这只是模拟案例中的已知材料，不能声称已运行测试。'))
      }
    }))
    const result = await new GoogleProvider().generate(context)
    expect(calls).toBe(2)
    expect(declarations).toContainEqual(expect.objectContaining({ name: 'readKnownFact' }))
    expect(responseParts).toContainEqual(expect.objectContaining({ functionResponse: expect.objectContaining({ name: 'readKnownFact', response: expect.objectContaining({ content: { fact: context.facts[0] } }) }) }))
    expect(responseParts).toContainEqual(expect.objectContaining({ thoughtSignature: 'dGVzdC1zaWduYXR1cmU=' }))
    expect(result.provider).toBe('google')
    expect(result.text).toContain('模拟案例')
  })
  it('旧剧情上游失败不会产生模拟降级回合，原行动可安全重试', async () => {
    await configure(createServer((_req, res) => { res.writeHead(503); res.end('upstream-secret-body') }))
    const store = new Store(':memory:')
    stores.push(store)
    new ContentService(store).seed()
    const userId = new AuthService(store).guest().user.id
    const game = new GameService(store), session = game.create(userId, { packId: demoPack.id, seed: 'google-outage' })
    const input = { clientActionId: crypto.randomUUID(), expectedRevision: session.revision, branchId: session.branchId, kind: 'message', text: '请说明当前已知材料。', channel: 'group' }
    const count = store.get<{ n: number }>('SELECT COUNT(*) n FROM event_logs')!.n
    await expect(game.act(userId, session.id, input)).rejects.toMatchObject({ code: 'AI_UPSTREAM_FAILED' })
    expect(game.get(userId, session.id).revision).toBe(session.revision)
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM event_logs')!.n).toBe(count)
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM action_receipts')!.n).toBe(0)
    expect(game.turn(userId, session.id, input.clientActionId).status).toBe('failed')
  })
  it('Google配置不会使用OpenAI凭据；拒绝缺失、嵌入凭据和查询参数', () => {
    vi.stubEnv('AI_PROVIDER', 'google')
    vi.stubEnv('GALGAME_ENABLED', '1')
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', '')
    vi.stubEnv('GOOGLE_MODEL', 'gemini-3-flash-test-fixture')
    vi.stubEnv('OPENAI_API_KEY', 'not-google')
    expect(galgameConfig().available).toBe(false)
    vi.stubEnv('GOOGLE_GENERATIVE_AI_API_KEY', 'test-google-secret')
    vi.stubEnv('GOOGLE_BASE_URL', 'https://example.com/')
    expect(modelConfig('google').url).toBe('https://example.com/v1beta')
    for (const url of ['https://name:secret@example.com', 'https://example.com?key=secret', 'file:///tmp/api']) {
      vi.stubEnv('GOOGLE_BASE_URL', url)
      expect(galgameConfig().available).toBe(false)
    }
  })
})
