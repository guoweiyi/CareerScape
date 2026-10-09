import { getRouterParam } from 'h3'
import { frameFactory } from '../../../../../../packages/contracts'
import { hash, id, AppError } from '../../../../../../packages/database'
import { endpoint, identity, services, body } from '../../../utils/api'

export default endpoint(async event => {
  const who = identity(event), sessionId = getRouterParam(event, 'id')!
  const game = services().sessions
  const input = game.parseAction(who.user.id, sessionId, await body(event))
  game.owned(who.user.id, sessionId)
  const streamId = id(), turnId = hash(`${sessionId}:${input.clientActionId}`)
  const frame = frameFactory({ streamId, turnId, sessionId, branchId: input.branchId })
  const encoder = new TextEncoder()
  let connected = true
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) => { if (connected) { try { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)) } catch { connected = false } } }
      send(frame('turn_started', { expectedRevision: input.expectedRevision }))
      send(frame('tool_status', { status: 'preparing', label: '正在核对已保存的路线' }))
      const timer = setInterval(() => send(frame('heartbeat', {})), 10000)
      void game.act(who.user.id, sessionId, input, stage => send(frame('tool_status', { status: stage, label: { generating: '同事正在考虑你的行动', validating: '正在核对任务与材料', saving: '正在保存这一段故事' }[stage] }))).then(result => {
        for (const message of result.messages) {
          send(frame('message_start', { messageId: message.id, provisional: false, committedRevision: result.session.revision, speakerId: message.speakerId }))
          // Text is streamed only after commit; a truncated visual stream cannot mutate authoritative state.
          for (let offset = 0; offset < message.text.length; offset += 80) send(frame('message_delta', { messageId: message.id, provisional: false, committedRevision: result.session.revision, text: message.text.slice(offset, offset + 80) }))
        }
        send(frame('turn_committed', { revision: result.session.revision, eventSeq: result.session.eventSeq, messageIds: result.messages.map(m => m.id), session: result.session }))
        send(frame('stream_end', { status: 'committed' }))
      }).catch((error: unknown) => {
        const known = error instanceof AppError || (error instanceof Error && error.name === 'NarrativeError')
        const code = error instanceof AppError ? error.code : known && 'code' in error ? String(error.code) : 'TURN_FAILED'
        send(frame('turn_failed', { code, message: known && error instanceof Error ? error.message.slice(0, 300) : '回合未提交，请查询状态后重试。', retryable: ['TURN_RUNNING', 'LEASE_LOST', 'TURN_FAILED'].includes(code) || (code.startsWith('AI_') && !['AI_DAILY_LIMIT', 'AI_UNAVAILABLE'].includes(code)), revision: input.expectedRevision }))
        send(frame('stream_end', { status: 'failed' }))
      }).finally(() => { clearInterval(timer); if (connected) { try { controller.close() } catch { /* client disconnected */ } } })
    },
    cancel() { connected = false /* Network cancellation does not roll back a committed action. */ },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' } })
})
