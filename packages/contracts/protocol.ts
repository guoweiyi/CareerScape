import { z } from 'zod'

const envelope = { protocolVersion: z.literal(1), frameId: z.string().min(1).max(100), streamId: z.string().min(1).max(100), streamSeq: z.number().int().positive(), turnId: z.string().min(1).max(100), sessionId: z.string().min(1).max(100), branchId: z.string().min(1).max(100), at: z.string().datetime() }
const commitRevision = z.number().int().nonnegative()
const committedText = { messageId: z.string().min(1), provisional: z.literal(false), committedRevision: commitRevision }
// The transport carries an opaque full snapshot; callers must validate their session DTO before replacing authoritative state.
export const FrameSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('turn_started'), payload: z.object({ expectedRevision: commitRevision }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('message_start'), payload: z.object({ ...committedText, speakerId: z.enum(['lin', 'zhou', 'xu', 'narrator', 'player']) }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('message_delta'), payload: z.object({ ...committedText, text: z.string().max(16000) }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('tool_status'), payload: z.object({ status: z.enum(['preparing', 'generating', 'validating', 'saving']), label: z.string().max(100) }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('turn_committed'), payload: z.object({ revision: commitRevision, eventSeq: z.number().int().nonnegative(), messageIds: z.array(z.string()), session: z.record(z.string(), z.unknown()) }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('turn_failed'), payload: z.object({ code: z.string().max(80), message: z.string().max(300), retryable: z.boolean(), revision: commitRevision }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('turn_cancelled'), payload: z.object({ revision: commitRevision }).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('heartbeat'), payload: z.object({}).strict() }).strict(),
  z.object({ ...envelope, type: z.literal('stream_end'), payload: z.object({ status: z.enum(['committed', 'failed', 'cancelled']) }).strict() }).strict(),
])
export type Frame = z.infer<typeof FrameSchema>
export type FramePayload<T extends Frame['type']> = Extract<Frame, { type: T }>['payload']
export type FrameContext = Pick<Frame, 'streamId' | 'turnId' | 'sessionId' | 'branchId'>
export function frameFactory(context: FrameContext, now = () => new Date().toISOString()) {
  let streamSeq = 0
  return <T extends Frame['type']>(type: T, payload: FramePayload<T>): Frame => FrameSchema.parse({ ...context, protocolVersion: 1, frameId: `${context.streamId}:${++streamSeq}`, streamSeq, at: now(), type, payload })
}
export class ProtocolError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'ProtocolError' }
}

/** Incremental UTF-8 JSONL. Invalid streams fail closed; reconnect using the persisted turn, never a partial state patch. */
export class JsonlParser {
  private decoder = new TextDecoder('utf-8', { fatal: true })
  private buffer = ''
  private bytes = 0
  private seq = 0
  private stream: FrameContext | undefined
  private seen = new Map<number, string>()
  private frameIds = new Set<string>()
  private ended = false
  private failed = false
  private outcome: 'committed' | 'failed' | 'cancelled' | undefined
  private expectedRevision: number | undefined
  private startedMessages = new Map<string, number>()
  private encoder = new TextEncoder()
  constructor(private readonly options: { maxLineBytes?: number; maxTotalBytes?: number; maxFrames?: number } = {}) {}

  push(chunk: Uint8Array): Frame[] {
    if (this.failed) throw new ProtocolError('PARSER_FAILED', '流已失效，请重新对齐已保存状态')
    try {
      this.bytes += chunk.byteLength
      if (this.bytes > (this.options.maxTotalBytes ?? 2_000_000)) this.fail('STREAM_TOO_LARGE', '本回合响应超出上限')
      this.buffer += this.decoder.decode(chunk, { stream: true })
      return this.drain(false)
    } catch (error) {
      this.failed = true
      if (error instanceof ProtocolError) throw error
      throw new ProtocolError('INVALID_UTF8', '响应不是有效 UTF-8')
    }
  }
  finish(): Frame[] {
    if (this.failed) throw new ProtocolError('PARSER_FAILED', '流已失效，请重新对齐已保存状态')
    try {
      this.buffer += this.decoder.decode()
      const frames = this.drain(true)
      if (!this.ended) this.fail('MISSING_END', '连接已断开，需查询回合提交状态')
      return frames
    } catch (error) {
      this.failed = true
      if (error instanceof ProtocolError) throw error
      throw new ProtocolError('INVALID_UTF8', '响应包含不完整 UTF-8')
    }
  }
  private fail(code: string, message: string): never { this.failed = true; throw new ProtocolError(code, message) }
  private drain(final: boolean): Frame[] {
    const result: Frame[] = []
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      const frame = this.parseLine(line)
      if (frame) result.push(frame)
      newline = this.buffer.indexOf('\n')
    }
    if (this.encoder.encode(this.buffer).byteLength > (this.options.maxLineBytes ?? 256_000)) this.fail('FRAME_TOO_LARGE', '单帧响应超出上限')
    if (final && this.buffer.length) { const frame = this.parseLine(this.buffer.replace(/\r$/, '')); this.buffer = ''; if (frame) result.push(frame) }
    return result
  }
  private parseLine(line: string): Frame | undefined {
    if (!line.trim()) return undefined
    if (this.encoder.encode(line).byteLength > (this.options.maxLineBytes ?? 256_000)) this.fail('FRAME_TOO_LARGE', '单帧响应超出上限')
    let raw: unknown
    try { raw = JSON.parse(line) } catch { this.fail('INVALID_JSON', '响应 JSON 无效') }
    if (raw && typeof raw === 'object' && 'protocolVersion' in raw && raw.protocolVersion !== 1) this.fail('UNSUPPORTED_VERSION', '协议版本不受支持，请刷新升级')
    const parsed = FrameSchema.safeParse(raw)
    if (!parsed.success) this.fail('INVALID_FRAME', '响应帧不符合协议')
    const frame = parsed.data
    const canonical = JSON.stringify(frame)
    if (this.stream && (frame.streamId !== this.stream.streamId || frame.turnId !== this.stream.turnId || frame.sessionId !== this.stream.sessionId || frame.branchId !== this.stream.branchId)) this.fail('CONTEXT_MISMATCH', '响应归属不一致')
    if (frame.streamSeq <= this.seq) {
      if (this.seen.get(frame.streamSeq) === canonical) return undefined
      this.fail('DUPLICATE_CONFLICT', '重复帧内容冲突')
    }
    if (this.ended) this.fail('AFTER_END', '结束帧之后出现新事件')
    if (frame.streamSeq !== this.seq + 1) this.fail('SEQUENCE_GAP', '响应缺帧，请重新查询回合')
    if (this.frameIds.has(frame.frameId)) this.fail('FRAME_ID_REUSED', '帧 ID 重复使用')
    if (frame.streamSeq > (this.options.maxFrames ?? 4096)) this.fail('TOO_MANY_FRAMES', '响应帧数量超出上限')
    if (this.seq === 0 && frame.type !== 'turn_started') this.fail('MISSING_START', '响应缺少开始帧')
    if (frame.type === 'turn_started') {
      if (this.seq !== 0) this.fail('MULTIPLE_STARTS', '一个流只能开始一次回合')
      this.expectedRevision = frame.payload.expectedRevision
    }
    if (this.outcome && ['message_start', 'message_delta', 'tool_status'].includes(frame.type)) this.fail('AFTER_OUTCOME', '业务结果之后不能追加消息或工具状态')
    if (frame.type === 'message_start') {
      if (this.startedMessages.has(frame.payload.messageId)) this.fail('MESSAGE_RESTARTED', '消息 ID 不能重复开始')
      if (frame.payload.committedRevision !== this.expectedRevision! + 1) this.fail('MESSAGE_REVISION', '已保存文字的修订与本回合不一致')
      this.startedMessages.set(frame.payload.messageId, frame.payload.committedRevision)
    }
    if (frame.type === 'message_delta' && this.startedMessages.get(frame.payload.messageId) !== frame.payload.committedRevision) this.fail('MESSAGE_NOT_STARTED', '文字分段没有对应的消息起始或修订不一致')
    if (frame.type === 'turn_committed') {
      if (frame.payload.revision !== this.expectedRevision! + 1) this.fail('COMMIT_REVISION', '业务提交修订与请求不一致')
      const committedIds = new Set(frame.payload.messageIds)
      if (committedIds.size !== frame.payload.messageIds.length || committedIds.size !== this.startedMessages.size || [...this.startedMessages.keys()].some(id => !committedIds.has(id))) this.fail('COMMIT_MESSAGES', '提交通知的消息列表与实际流不一致')
    }
    if (frame.type === 'turn_committed' || frame.type === 'turn_failed' || frame.type === 'turn_cancelled') {
      if (this.outcome) this.fail('MULTIPLE_OUTCOMES', '一个流只能包含一次业务结果')
      this.outcome = frame.type === 'turn_committed' ? 'committed' : frame.type === 'turn_failed' ? 'failed' : 'cancelled'
    }
    if (frame.type === 'stream_end') {
      if (!this.outcome || frame.payload.status !== this.outcome) this.fail('END_WITHOUT_OUTCOME', '结束帧不能代替业务提交')
      this.ended = true
    }
    this.stream ??= { streamId: frame.streamId, turnId: frame.turnId, sessionId: frame.sessionId, branchId: frame.branchId }
    this.seq = frame.streamSeq
    this.seen.set(frame.streamSeq, canonical)
    this.frameIds.add(frame.frameId)
    return frame
  }
}

export async function readJsonlStream(response: Response, onFrame: (frame: Frame) => void, signal?: AbortSignal): Promise<void> {
  if (!response.ok) throw new ProtocolError(`HTTP_${response.status}`, '请求失败，请重新获取存档状态')
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) throw new ProtocolError('CONTENT_TYPE', '响应格式不正确')
  const reader = response.body?.getReader()
  if (!reader) throw new ProtocolError('EMPTY_BODY', '响应缺少数据流')
  const parser = new JsonlParser()
  const onAbort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('读取已取消；服务端动作可能已提交', 'AbortError')
      const { done, value } = await reader.read()
      if (signal?.aborted) throw new DOMException('读取已取消；服务端动作可能已提交', 'AbortError')
      if (done) break
      for (const frame of parser.push(value)) onFrame(frame)
    }
    for (const frame of parser.finish()) onFrame(frame)
  } catch (error) { await reader.cancel().catch(() => undefined); throw error }
  finally { signal?.removeEventListener('abort', onAbort); reader.releaseLock() }
}
