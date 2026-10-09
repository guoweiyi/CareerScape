import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import {
  OpenAICompatibleGalgameProvider,
  galgameConfig,
  type GalgameModelUsage,
} from '../packages/agent/galgame'
import { GalgameNpcResponseSchema } from '../packages/contracts/galgame'
import { fixtureModelServer } from './fixtures/galgame-model-server'

const servers: Server[] = []
async function configure(server: Server) {
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  vi.stubEnv('GALGAME_ENABLED', '1')
  vi.stubEnv('OPENAI_MODEL', 'test-fixture')
  vi.stubEnv('OPENAI_API_KEY', 'test-only-key')
  vi.stubEnv('OPENAI_BASE_URL', `http://127.0.0.1:${address.port}/v1`)
}
afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections()
          server.close(() => resolve())
        }),
    ),
  )
})
const request = {
  role: 'npc' as const,
  context: {
    actionKind: 'message',
    currentInput: '请解释已知材料',
    occupationTitle: '软件测试工程师',
    character: { id: 'lin', name: '林澄' },
    facts: [{ id: 'case', text: '这是虚构案例，不存在真实运行环境。' }],
    sources: [],
  },
}
describe('OpenAI兼容HTTP协议（显式测试模型）', () => {
  it('调用Chat Completions并解析结构化JSON，保留供应商实际报告的token数', async () => {
    await configure(fixtureModelServer())
    const usage: GalgameModelUsage[] = []
    const result = await new OpenAICompatibleGalgameProvider().generate(
      GalgameNpcResponseSchema,
      request,
      AbortSignal.timeout(3000),
      (call) => usage.push(call),
    )
    expect(result.factIds).toEqual(['case'])
    expect(result.text).toContain('虚构案例')
    expect(usage).toMatchObject([
      { model: 'test-fixture', status: 'succeeded', inputTokens: 10, outputTokens: 20 },
    ])
  })
  it('上游异常仅返回安全错误，不泄露密钥或响应正文，不伪造token为0', async () => {
    await configure(
      createServer((_request, response) => {
        response.writeHead(503)
        response.end('upstream-secret-body')
      }),
    )
    const usage: GalgameModelUsage[] = []
    await expect(
      new OpenAICompatibleGalgameProvider().generate(
        GalgameNpcResponseSchema,
        request,
        AbortSignal.timeout(3000),
        (call) => usage.push(call),
      ),
    ).rejects.toMatchObject({
      code: 'AI_UPSTREAM_FAILED',
      message: '模型服务暂不可用，本回合未保存，请稍后重试。',
    })
    expect(usage).toMatchObject([
      { status: 'failed', inputTokens: null, outputTokens: null, failureCode: 'AI_UPSTREAM_FAILED' },
    ])
  })
  it('超时中止HTTP请求，记录失败且不使用mock', async () => {
    await configure(
      createServer((_request, _response) => {
        /* Explicit fixture that never answers. */
      }),
    )
    const usage: GalgameModelUsage[] = []
    await expect(
      new OpenAICompatibleGalgameProvider().generate(
        GalgameNpcResponseSchema,
        request,
        AbortSignal.timeout(50),
        (call) => usage.push(call),
      ),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' })
    expect(usage[0]?.failureCode).toBe('AI_TIMEOUT')
  })
  it.each(['invalid-json', 'truncated'] as const)('%s在保存前失败，供应商报告的用量仍保留', async (mode) => {
    await configure(
      createServer((_request, response) => {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            id: 'invalid-fixture',
            object: 'chat.completion',
            created: 1,
            model: 'test-fixture',
            choices: [
              {
                index: 0,
                finish_reason: mode === 'truncated' ? 'length' : 'stop',
                message: { role: 'assistant', content: '{"text":' },
              },
            ],
            usage: { prompt_tokens: 17, completion_tokens: 23, total_tokens: 40 },
          }),
        )
      }),
    )
    const usage: GalgameModelUsage[] = []
    await expect(
      new OpenAICompatibleGalgameProvider().generate(
        GalgameNpcResponseSchema,
        request,
        AbortSignal.timeout(3000),
        (call) => usage.push(call),
      ),
    ).rejects.toMatchObject({ code: mode === 'truncated' ? 'AI_OUTPUT_TRUNCATED' : 'AI_INVALID_OUTPUT' })
    expect(usage[0]).toMatchObject({ status: 'failed', inputTokens: 17, outputTokens: 23 })
  })
  it('显式开关、密钥、模型名均必需；不接受带凭据或非法协议的baseURL', () => {
    vi.stubEnv('GALGAME_ENABLED', '0')
    vi.stubEnv('OPENAI_API_KEY', 'test-key')
    vi.stubEnv('OPENAI_MODEL', 'test-model')
    expect(galgameConfig().available).toBe(false)
    vi.stubEnv('GALGAME_ENABLED', '1')
    vi.stubEnv('OPENAI_MODEL', '')
    expect(galgameConfig().available).toBe(false)
    vi.stubEnv('OPENAI_MODEL', 'test-model')
    vi.stubEnv('OPENAI_BASE_URL', 'https://name:password@example.com/v1')
    expect(galgameConfig().available).toBe(false)
  })
})
