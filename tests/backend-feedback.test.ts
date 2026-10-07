import { afterEach, describe, expect, it } from 'vitest'
import { Store, id, now } from '../packages/database'
import { AuthService } from '../apps/web/server/services/auth'
import { ContentService } from '../apps/web/server/services/content'
import { FeedbackService } from '../apps/web/server/services/feedback'
import { GameService } from '../apps/web/server/services/game'
import { demoPack } from '../packages/content/seed'

const opened: Store[] = []
function setup(withSession = false) {
  const store = new Store(':memory:')
  opened.push(store)
  const auth = new AuthService(store),
    guest = auth.guest()
  const who = auth.lookup('raw' in guest ? guest.raw : undefined)!
  const feedback = new FeedbackService(store)
  const game = new GameService(store)
  if (withSession) {
    new ContentService(store).seed()
    store.run("UPDATE packs SET status='published',active=1 WHERE version=?", String(demoPack.version))
  }
  const session = withSession
    ? game.create(who.user.id, { packId: demoPack.id, seed: 'feedback-fixture' })
    : undefined
  return { store, auth, who, feedback, game, session }
}
afterEach(() => {
  for (const store of opened.splice(0)) store.close()
})
const input = { consent: true, kind: 'experience', text: '明确提交的测试反馈' }

describe('voluntary feedback privacy boundary', () => {
  it('accepts a guest submission and stores only the consented envelope', () => {
    const { store, who, feedback, auth } = setup()
    const response = feedback.submit(who, { ...input, text: '  明确提交的测试反馈  ' })
    expect(who.user.isGuest).toBe(true)
    expect(Object.keys(response).sort()).toEqual(['createdAt', 'id'])
    const row = store.get<{ owner_id: string; session_id: string | null; text: string }>(
      'SELECT * FROM feedback WHERE id=?',
      response.id,
    )!
    expect(row.owner_id).toBe(who.user.id)
    expect(row.session_id).toBeNull()
    expect(JSON.parse(row.text)).toEqual({
      schemaVersion: 'feedback-v1',
      consent: true,
      kind: 'experience',
      text: input.text,
    })
    expect(auth.export(who.user.id).feedback).toHaveLength(1)
  })

  it('rejects absent/false consent, unknown fields, unsupported kinds and oversized text', () => {
    const { store, who, feedback } = setup()
    for (const invalid of [
      { kind: 'experience', text: '无明确同意' },
      { ...input, consent: false },
      { ...input, consent: 'true' },
      { ...input, kind: 'private_chat' },
      { ...input, text: ' ' },
      { ...input, text: '字'.repeat(2001) },
      { ...input, ownerId: 'another-owner' },
      { ...input, messages: ['不得附带私聊'] },
      { ...input, journal: '不得附带手账' },
      { ...input, text: '\u0000'.repeat(2000) },
    ])
      expect(() => feedback.submit(who, invalid)).toThrow()
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM feedback')!.n).toBe(0)
  })

  it('associates only a session owned by the submitting identity, including admins', () => {
    const { store, auth, who, feedback, session } = setup(true)
    const otherGuest = auth.guest(),
      other = auth.lookup('raw' in otherGuest ? otherGuest.raw : undefined)!
    other.user.roles = ['admin']
    expect(() => feedback.submit(other, { ...input, sessionId: session!.id })).toThrowError(
      expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
    )
    expect(() => feedback.submit(who, { ...input, sessionId: id() })).toThrowError(
      expect.objectContaining({ code: 'SESSION_NOT_FOUND' }),
    )
    const submitted = feedback.submit(who, { ...input, sessionId: session!.id })
    expect(
      store.get<{ session_id: string }>('SELECT session_id FROM feedback WHERE id=?', submitted.id)!
        .session_id,
    ).toBe(session!.id)
  })

  it('restricts the review list to editor/reviewer/admin without exposing owner or session identifiers', () => {
    const { who, feedback } = setup()
    feedback.submit(who, input)
    expect(() => feedback.list(who)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
    for (const role of ['editor', 'reviewer', 'admin']) {
      who.user.roles = [role]
      const result = feedback.list(who)
      expect(result.items).toHaveLength(1)
      expect(Object.keys(result.items[0]!).sort()).toEqual(['createdAt', 'kind', 'text'])
      expect(result.items[0]).toMatchObject({ kind: 'experience', text: input.text })
      expect(JSON.stringify(result)).not.toContain(who.user.id)
      expect(JSON.stringify(result)).not.toContain(who.tokenHash)
      expect(JSON.stringify(result)).not.toContain(who.csrfToken)
    }
  })

  it('does not copy private chat or journal into feedback and hides legacy/unconsented payloads', async () => {
    const { store, who, feedback, game, session } = setup(true)
    game.journal(who.user.id, session!.id, session!.branchId, '私密手账测试标记')
    await game.act(who.user.id, session!.id, {
      clientActionId: id(),
      expectedRevision: session!.revision,
      branchId: session!.branchId,
      kind: 'message',
      text: '私聊测试标记仅周砚可见',
      channel: 'private',
      recipientId: 'zhou',
    })
    feedback.submit(who, { ...input, kind: 'content_issue', sessionId: session!.id })
    store.run('INSERT INTO feedback VALUES (?,?,?,?,?)', id(), who.user.id, null, '旧记录没有同意证据', now())
    store.run(
      'INSERT INTO feedback VALUES (?,?,?,?,?)',
      id(),
      who.user.id,
      null,
      JSON.stringify({
        schemaVersion: 'feedback-v1',
        consent: false,
        kind: 'experience',
        text: '不应公开的反馈',
      }),
      now(),
    )
    store.run(
      'INSERT INTO feedback VALUES (?,?,?,?,?)',
      id(),
      who.user.id,
      null,
      JSON.stringify({
        schemaVersion: 'feedback-v1',
        consent: true,
        kind: 'experience',
        text: '附加私密字段',
        journal: '隐藏字段',
      }),
      now(),
    )
    who.user.roles = ['reviewer']
    const result = feedback.list(who)
    expect(result.items).toHaveLength(1)
    const serialized = JSON.stringify(result)
    for (const marker of [
      '私密手账测试标记',
      '私聊测试标记',
      '旧记录',
      '不应公开',
      '附加私密字段',
      session!.id,
      who.user.id,
    ])
      expect(serialized).not.toContain(marker)
    const stored = store
      .all<{ text: string }>('SELECT text FROM feedback')
      .map((row) => row.text)
      .join('')
    expect(stored).not.toContain('私密手账测试标记')
    expect(stored).not.toContain('私聊测试标记')
  })

  it('cascades session and account deletion over feedback and rejects the removed identity', () => {
    const { store, auth, who, feedback, session } = setup(true)
    feedback.submit(who, { ...input, sessionId: session!.id })
    feedback.submit(who, input)
    store.run('DELETE FROM sessions WHERE id=?', session!.id)
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM feedback')!.n).toBe(1)
    auth.delete(who.user.id)
    expect(store.get<{ n: number }>('SELECT COUNT(*) n FROM feedback')!.n).toBe(0)
    expect(() => feedback.submit(who, input)).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED' }))
  })
})
