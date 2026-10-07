import { describe, expect, it } from 'vitest'
import { FrameSchema, JsonlParser, frameFactory, type Frame } from '../packages/contracts'

function conversation(): Frame[] {
  const frame = frameFactory({ streamId: 'stream1', turnId: 'turn1', sessionId: 'session1', branchId: 'branch1' }, () => '2026-10-08T00:00:00.000Z')
  return [frame('turn_started', { expectedRevision: 0 }), frame('heartbeat', {}), frame('message_start', { messageId: 'msg1', speakerId: 'lin', provisional: false, committedRevision: 1 }), frame('message_delta', { messageId: 'msg1', text: '你好，小云🌱', provisional: false, committedRevision: 1 }), frame('turn_committed', { revision: 1, eventSeq: 1, messageIds: ['msg1'], session: { id: 'session1', revision: 1 } }), frame('stream_end', { status: 'committed' })]
}
const bytes = (frames: unknown[], delimiter = '\n') => new TextEncoder().encode(frames.map(frame => JSON.stringify(frame)).join(delimiter))
describe('严格 JSONL 增量协议', () => {
  it('UTF-8 任意跨字节、半行、CRLF、多帧和末尾无换行完整解析', () => {
    const input = bytes(conversation(), '\r\n'); const parser = new JsonlParser(); const output: Frame[] = []
    for (const byte of input) output.push(...parser.push(new Uint8Array([byte])))
    output.push(...parser.finish())
    expect(output).toEqual(conversation())
  })
  it('完全一致重传幂等；同 seq 异正文拒绝', () => {
    const frames = conversation(); const parser = new JsonlParser()
    expect(parser.push(bytes([frames[0], frames[0], ...frames.slice(1)], '\n').map(value => value)).length).toBe(5)
    expect(parser.finish()).toHaveLength(1)
    const bad = new JsonlParser(); const conflict = structuredClone(frames[0])!; conflict.frameId = 'different'
    expect(() => bad.push(bytes([frames[0], conflict, frames[1], '']))).toThrow('重复帧内容冲突')
  })
  it.each([
    ['缺号', () => { const frames = conversation(); frames.splice(1, 1); return frames }, '缺帧'],
    ['归属混入', () => { const frames = conversation(); frames[1]!.branchId = 'other'; return frames }, '归属不一致'],
    ['复用帧 ID', () => { const frames = conversation(); frames[1]!.frameId = frames[0]!.frameId; return frames }, 'ID 重复'],
    ['未知版本', () => { const frames = conversation(); return frames.map(frame => ({ ...frame, protocolVersion: 2 })) }, '版本不受支持'],
  ])('%s 触发重新对齐', (_, make, expected) => {
    const parser = new JsonlParser(); expect(() => { parser.push(bytes(make())); parser.finish() }).toThrow(expected)
  })
  it('坏 JSON、未知字段、非法 UTF-8 与过大帧失败关闭', () => {
    expect(() => new JsonlParser().push(new TextEncoder().encode('{bad}\n'))).toThrow('JSON 无效')
    expect(() => new JsonlParser().push(bytes([{ ...conversation()[0], admin: true }, '']))).toThrow('不符合协议')
    expect(() => new JsonlParser().push(new Uint8Array([255, 10]))).toThrow('UTF-8')
    expect(() => new JsonlParser({ maxLineBytes: 16 }).push(bytes(conversation()))).toThrow('单帧')
    expect(() => new JsonlParser({ maxTotalBytes: 16 }).push(bytes(conversation()))).toThrow('本回合')
  })
  it('缺 end 不宣称同步成功；end 不能替代提交', () => {
    const parser = new JsonlParser(); parser.push(bytes(conversation().slice(0, -1)))
    expect(() => parser.finish()).toThrow('连接已断开')
    const factory = frameFactory({ streamId: 's', turnId: 't', sessionId: 'ss', branchId: 'b' })
    const bad = new JsonlParser(); bad.push(bytes([factory('turn_started', { expectedRevision: 0 }), factory('stream_end', { status: 'committed' })]))
    expect(() => bad.finish()).toThrow('不能代替业务提交')
  })
  it('message_delta 不能包含权威状态，也不允许未提交预览', () => {
    const frame = conversation()[3]
    expect(frame?.type).toBe('message_delta')
    if (frame?.type !== 'message_delta') throw new Error('test fixture')
    expect(FrameSchema.safeParse({ ...frame, payload: { ...frame.payload, stateDelta: { isAdmin: true } } }).success).toBe(false)
    expect(FrameSchema.safeParse({ ...frame, payload: { ...frame.payload, provisional: true } }).success).toBe(false)
  })
})
