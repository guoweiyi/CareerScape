import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { fixtureReply } from './galgame-provider'
import type { GalgameModelRequest } from '../../packages/agent/galgame'
import { MockProvider, type RoleContext } from '../../packages/agent'

export function fixtureModelServer() {
  let failNext = false,
    calls = 0
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url === '/health') {
      response.end(JSON.stringify({ ok: true, fixture: true, calls }))
      return
    }
    if (request.url === '/__fixture/fail-next') {
      failNext = true
      response.end('{}')
      return
    }
    const nativeGoogle = /^\/v1beta\/models\/[^/]+:generateContent$/.test(request.url || '')
    if ((!nativeGoogle && request.url !== '/v1/chat/completions') || request.method !== 'POST') {
      response.writeHead(404)
      response.end('{}')
      return
    }
    calls++
    if (failNext) {
      failNext = false
      response.writeHead(503)
      response.end(
        JSON.stringify({ error: { message: 'Explicit test fixture outage', type: 'test_failure' } }),
      )
      return
    }
    try {
      let body = ''
      for await (const chunk of request) {
        body += String(chunk)
        if (body.length > 200000) throw new Error('fixture input limit')
      }
      const input = JSON.parse(body) as { model: string; messages: { role: string; content: string }[]; contents: { role: string; parts: { text?: string }[] }[] }
      const envelope = JSON.parse(
        nativeGoogle ? input.contents.filter(content => content.role === 'user').at(-1)!.parts.map(part => part.text || '').join('') : input.messages
          .slice()
          .reverse()
          .find((message) => message.role === 'user')!.content,
      ) as GalgameModelRequest
      const reply = envelope.role
        ? JSON.stringify(fixtureReply(envelope))
        : (await new MockProvider().generate(envelope as unknown as RoleContext)).text
      if (nativeGoogle) {
        response.end(JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: reply }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
        }))
        return
      }
      response.end(
        JSON.stringify({
          id: `fixture-${calls}`,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: input.model,
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
              message: { role: 'assistant', content: reply },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
      )
    } catch {
      response.writeHead(400)
      response.end(
        JSON.stringify({ error: { message: 'Invalid explicit test fixture request', type: 'test_failure' } }),
      )
    }
  })
  return server
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = fixtureModelServer()
  server.listen(3219, '127.0.0.1', () => console.log('Explicit test-only model fixture on 127.0.0.1:3219'))
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => server.close(() => process.exit(0)))
}
