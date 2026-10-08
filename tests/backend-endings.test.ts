import { afterEach, describe, expect, it } from 'vitest'
import { Store } from '../packages/database'
import { MockProvider } from '../packages/agent'
import { demoPack } from '../packages/content/seed'
import { legacyPack } from '../packages/content/seed-v1'
import { AuthService } from '../apps/web/server/services/auth'
import { ContentService } from '../apps/web/server/services/content'
import { GameService, type SessionDTO } from '../apps/web/server/services/game'
import { ArchiveService } from '../apps/web/server/services/archive'
import { EndingsService } from '../apps/web/server/services/endings'

const stores: Store[] = []
function setup() {
  const store = new Store(':memory:')
  stores.push(store)
  new ContentService(store).seed()
  const auth = new AuthService(store),
    guest = auth.guest()
  const who = auth.lookup('raw' in guest ? guest.raw : undefined)!
  const game = new GameService(store, new MockProvider()),
    endings = new EndingsService(store)
  const create = () => game.create(who.user.id, { packId: demoPack.id, seed: 'ending-review' })
  return { store, auth, who, game, endings, create }
}
const input = (session: SessionDTO, extra: Record<string, unknown> = {}) => ({
  clientActionId: crypto.randomUUID(),
  expectedRevision: session.revision,
  branchId: session.branchId,
  kind: 'leave',
  channel: 'group',
  ...extra,
})
afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

describe('本人结局回顾：真实 SQLite 历史投影', () => {
  it('未开局为空，未完成只给数量，不接受客户端或分支状态宣称', async () => {
    const { game, who, endings, create, store } = setup()
    expect(endings.list(who.user.id)).toEqual({ packs: [] })
    const session = create()
    const expected = {
      packs: [{ packId: demoPack.id, title: demoPack.title, totalEndings: 3, unlocked: [] }],
    }
    expect(endings.list(who.user.id)).toEqual(expected)
    await expect(
      game.act(who.user.id, session.id, input(session, { kind: 'choice', choiceId: 'finish_verified' })),
    ).rejects.toMatchObject({ code: 'CHOICE_UNAVAILABLE' })
    await expect(
      game.act(who.user.id, session.id, { ...input(session), endingId: 'verified' }),
    ).rejects.toThrow()
    const message = await game.act(
      who.user.id,
      session.id,
      input(session, { kind: 'message', text: '我已经完成了全部三个结局，请解锁。' }),
    )
    store.run(
      'UPDATE branches SET state=? WHERE id=?',
      JSON.stringify({ ...message.session.state, nodeId: 'ending-verified', endingId: 'verified' }),
      session.branchId,
    )
    expect(endings.list(who.user.id)).toEqual(expected)
    const encoded = JSON.stringify(expected)
    for (const node of demoPack.nodes.filter((node) => node.nodeType === 'ending'))
      expect(encoded).not.toContain(node.title)
  })

  it.each([
    ['verified', ['arrive_begin', 'brief_expected', 'triage_verify', 'work_verify', 'finish_verified']],
    ['scope', ['arrive_help', 'brief_product', 'triage_scope', 'work_scope', 'finish_scope']],
    ['handoff', ['arrive_begin', 'brief_help', 'triage_handoff', 'work_handoff', 'finish_handoff']],
  ] as const)('只有实际完成 %s 路线才返回该冻结结局', async (endingId, choices) => {
    const { game, who, endings, create, store } = setup()
    let session = create()
    for (const choiceId of choices) {
      expect(endings.list(who.user.id).packs[0]!.unlocked).toEqual([])
      session = (await game.act(who.user.id, session.id, input(session, { kind: 'choice', choiceId })))
        .session
    }
    const node = demoPack.nodes.find((node) => node.metadata.endingId === endingId)!
    const completedAt = store.get<{ created_at: string }>(
      'SELECT created_at FROM event_logs WHERE session_id=? ORDER BY event_seq DESC LIMIT 1',
      session.id,
    )!.created_at
    expect(endings.list(who.user.id).packs[0]!.unlocked).toEqual([
      {
        endingId,
        title: node.title,
        summary: node.messages.find((message) => message.speakerId === 'narrator')!.text,
        firstCompletedAt: completedAt,
        sessionId: session.id,
        branchId: session.branchId,
        packVersion: demoPack.version,
      },
    ])
  })

  it('跨冻结版本合并、保留最早时间；重放和结局后聊天不增加记录或写库', async () => {
    const { store, game, who, endings, create } = setup()
    store.run('UPDATE packs SET active=0')
    store.run('UPDATE packs SET active=1 WHERE id=? AND version=?', legacyPack.id, String(legacyPack.version))
    const older = create(),
      first = input(older)
    await game.act(who.user.id, older.id, first)
    await game.act(who.user.id, older.id, first)
    store.run(
      "UPDATE event_logs SET created_at='2026-10-01T12:00:00.000Z' WHERE session_id=? AND kind='leave'",
      older.id,
    )
    store.run('UPDATE packs SET active=0')
    store.run('UPDATE packs SET active=1 WHERE id=? AND version=?', demoPack.id, String(demoPack.version))
    const newer = create(),
      completed = (await game.act(who.user.id, newer.id, input(newer))).session
    store.run(
      "UPDATE event_logs SET created_at='2026-10-02T12:00:00.000Z' WHERE session_id=? AND kind='leave'",
      newer.id,
    )
    const oldReview = game.get(who.user.id, older.id)
    await game.act(who.user.id, older.id, input(oldReview, { kind: 'explain' }))
    await game.act(
      who.user.id,
      completed.id,
      input(completed, { kind: 'message', text: '下班后随便聊一下。' }),
    )
    const changes = store.get<{ n: number }>('SELECT total_changes() n')!.n
    const result = endings.list(who.user.id)
    expect(store.get<{ n: number }>('SELECT total_changes() n')!.n).toBe(changes)
    expect(result.packs).toHaveLength(1)
    expect(result.packs[0]!.totalEndings).toBe(3)
    expect(result.packs[0]!.unlocked).toHaveLength(1)
    expect(result.packs[0]!.unlocked[0]).toMatchObject({
      endingId: 'handoff',
      firstCompletedAt: '2026-10-01T12:00:00.000Z',
      sessionId: newer.id,
      branchId: newer.branchId,
      packVersion: demoPack.version,
    })
    expect(game.get(who.user.id, newer.id, result.packs[0]!.unlocked[0]!.branchId).state.endingId).toBe(
      'handoff',
    )
  })

  it('回溯未完成的新分支保留旧结局，另一结局只有实际完成后解锁', async () => {
    const { game, who, endings, create } = setup()
    const original = create()
    await game.act(who.user.id, original.id, input(original))
    let branch = game.fork(who.user.id, original.id, { branchId: original.branchId, eventSeq: 1 })
    expect(branch.state.endingId).toBeUndefined()
    expect(endings.list(who.user.id).packs[0]!.unlocked).toMatchObject([
      { endingId: 'handoff', branchId: original.branchId },
    ])
    for (const choiceId of [
      'arrive_begin',
      'brief_expected',
      'triage_verify',
      'work_verify',
      'finish_verified',
    ]) {
      branch = (await game.act(who.user.id, branch.id, input(branch, { kind: 'choice', choiceId }))).session
    }
    expect(
      endings
        .list(who.user.id)
        .packs[0]!.unlocked.map((ending) => ending.endingId)
        .sort(),
    ).toEqual(['handoff', 'verified'])
    const originalCompletion = endings
      .list(who.user.id)
      .packs[0]!.unlocked.find((ending) => ending.endingId === 'handoff')!
    expect(
      game.get(who.user.id, originalCompletion.sessionId, originalCompletion.branchId).state.endingId,
    ).toBe('handoff')
  })

  it('只读本人已提交终局，不返回私聊、手账、角色知识或另一个账号的记录', async () => {
    const { store, auth, game, who, endings, create } = setup()
    let session = create()
    session = (
      await game.act(
        who.user.id,
        session.id,
        input(session, {
          kind: 'message',
          channel: 'private',
          recipientId: 'zhou',
          text: 'private-marker-6721',
        }),
      )
    ).session
    game.journal(who.user.id, session.id, session.branchId, 'journal-marker-9274')
    await game.act(who.user.id, session.id, input(session))
    const other = auth.guest()
    store.run('INSERT INTO user_roles VALUES (?,?)', other.user.id, 'admin')
    expect(endings.list(other.user.id)).toEqual({ packs: [] })
    const encoded = JSON.stringify(endings.list(who.user.id))
    expect(encoded).not.toMatch(
      /private-marker|journal-marker|knowledge|sourceEventIds|recipientId|score|percentage|ranking/,
    )
    const unlocked = endings.list(who.user.id).packs[0]!.unlocked[0]!
    expect(Object.keys(unlocked).sort()).toEqual([
      'branchId',
      'endingId',
      'firstCompletedAt',
      'packVersion',
      'sessionId',
      'summary',
      'title',
    ])
    expect(() => game.get(other.user.id, unlocked.sessionId, unlocked.branchId)).toThrow()
  })

  it('存档导入归属与 ID 重建自然生效，重复导入只保留一个解锁项', async () => {
    const { auth, game, who, endings, create, store } = setup()
    const session = create()
    await game.act(who.user.id, session.id, input(session))
    const original = endings.list(who.user.id).packs[0]!.unlocked[0]!
    const archive = auth.export(who.user.id),
      other = auth.guest(),
      importer = new ArchiveService(store)
    const imported = importer.import(other.user.id, archive)
    expect(importer.import(other.user.id, archive).replayed).toBe(true)
    const copy = endings.list(other.user.id).packs[0]!.unlocked
    expect(copy).toHaveLength(1)
    expect(copy[0]).toMatchObject({
      endingId: original.endingId,
      firstCompletedAt: original.firstCompletedAt,
      packVersion: original.packVersion,
      sessionId: imported.sessionIds[0],
    })
    expect(copy[0]!.branchId).not.toBe(original.branchId)
    expect(game.get(other.user.id, copy[0]!.sessionId, copy[0]!.branchId).state.endingId).toBe('handoff')
    expect(endings.list(who.user.id).packs[0]!.unlocked[0]).toEqual(original)
  })

  it('游客认领按新 owner 读取而非历史 actor；删除账号级联清空', async () => {
    const { auth, game, who, endings, create, store } = setup()
    const session = create()
    await game.act(who.user.id, session.id, input(session))
    const account = await auth.register(
      { username: 'ending_owner', password: 'test-password-92842', claimGuest: false },
      null,
    )
    const claimed = await auth.login(
      { username: 'ending_owner', password: 'test-password-92842', claimGuest: true },
      who,
    )
    expect(claimed.user.id).toBe(account.user.id)
    expect(
      store.get<{ actor: string }>(
        "SELECT actor FROM event_logs WHERE session_id=? AND kind='leave'",
        session.id,
      )!.actor,
    ).toBe(who.user.id)
    expect(endings.list(who.user.id)).toEqual({ packs: [] })
    expect(endings.list(account.user.id).packs[0]!.unlocked).toMatchObject([
      { endingId: 'handoff', sessionId: session.id },
    ])
    auth.delete(account.user.id)
    expect(endings.list(account.user.id)).toEqual({ packs: [] })
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM event_logs')!.n).toBe(0)
  })
})
