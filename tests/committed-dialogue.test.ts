import { describe, expect, it } from 'vitest'
import { dialogueReadingDelay, latestCommittedDialogue } from '../apps/web/app/utils/committedDialogue'

describe('已提交对白的阅读投影', () => {
  it('只取最新事件的人物与旁白，保留实际顺序、频道与原文', () => {
    const messages = [
      { id: 'old', eventSeq: 1, speakerId: 'lin', text: '旧回合', channel: 'group' },
      { id: 'me', eventSeq: 2, speakerId: 'player', text: '我已提交的问题', channel: 'private' },
      { id: 'narration', eventSeq: 2, speakerId: 'narrator', text: '  原样旁白\n第二行。', channel: 'group' },
      { id: 'reply', eventSeq: 2, speakerId: 'zhou', text: '这是已提交的私聊回复。', channel: 'private' },
      { id: 'empty', eventSeq: 2, speakerId: 'xu', text: ' \n ', channel: 'group' },
    ]
    const before = structuredClone(messages)
    const result = latestCommittedDialogue(messages)
    expect(result.map(({ id }) => id)).toEqual(['narration', 'reply'])
    expect(result[0]?.text).toBe('  原样旁白\n第二行。')
    expect(result[1]?.channel).toBe('private')
    expect(messages).toEqual(before)
  })
  it('从全部事件编号确定最新批次，不把尾部旧历史混入', () => {
    const messages = [
      { eventSeq: 8, speakerId: 'lin', text: '当前' },
      { eventSeq: 3, speakerId: 'narrator', text: '更早' },
    ]
    expect(latestCommittedDialogue(messages).map((message) => message.text)).toEqual(['当前'])
  })
  it('空批次和只有玩家输入的最新事件不会回退播放旧回复', () => {
    expect(latestCommittedDialogue([])).toEqual([])
    expect(
      latestCommittedDialogue([
        { eventSeq: 1, speakerId: 'lin', text: '旧回复' },
        { eventSeq: 2, speakerId: 'player', text: '新问题' },
      ]),
    ).toEqual([])
  })
  it('阅读投影没有认可未知人物或空白材料', () => {
    expect(
      latestCommittedDialogue([
        { eventSeq: 1, speakerId: 'system', text: '工具状态' },
        { eventSeq: 1, speakerId: 'narrator', text: '材料原文' },
      ]),
    ).toEqual([{ eventSeq: 1, speakerId: 'narrator', text: '材料原文' }])
  })
})

describe('可选阅读计时', () => {
  it('短句至少保留3秒，3000字的长段也受12秒上限约束', () => {
    for (const speed of ['relaxed', 'standard', 'brisk'] as const) {
      expect(dialogueReadingDelay('你好。', speed)).toBe(3000)
      expect(dialogueReadingDelay('文'.repeat(3000), speed)).toBe(12000)
    }
  })
  it('时长随字数增加，三个速度有明确顺序', () => {
    const paragraph = '字'.repeat(30)
    expect(dialogueReadingDelay(paragraph, 'relaxed')).toBeGreaterThan(
      dialogueReadingDelay(paragraph, 'standard'),
    )
    expect(dialogueReadingDelay(paragraph, 'standard')).toBeGreaterThan(
      dialogueReadingDelay(paragraph, 'brisk'),
    )
    expect(dialogueReadingDelay('字'.repeat(40))).toBeGreaterThan(dialogueReadingDelay(paragraph))
  })
  it('忽略排版空白，并按Unicode码点计数，避免表情符号被算两次', () => {
    expect(dialogueReadingDelay('🌿'.repeat(20))).toBe(dialogueReadingDelay('字'.repeat(20)))
    expect(dialogueReadingDelay('字 \n'.repeat(20))).toBe(dialogueReadingDelay('字'.repeat(20)))
  })
})
