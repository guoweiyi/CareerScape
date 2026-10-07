import { z } from 'zod'
import type { Store } from '../../../../packages/database'
import { id, invariant, now } from '../../../../packages/database'
import type { Identity } from './auth'
import { AuthService } from './auth'

export const FeedbackKindSchema = z.enum(['experience', 'content_issue', 'technical_issue', 'suggestion'])
const FeedbackTextSchema = z
  .string()
  .trim()
  .min(1, '请写下想反馈的内容。')
  .max(2000, '反馈最多2000字。')
  .refine(
    (text) =>
      Array.from(text).every((character) => {
        const code = character.charCodeAt(0)
        return (code >= 32 && code !== 127) || [9, 10, 13].includes(code)
      }),
    '反馈包含不可用的控制字符。',
  )
export const FeedbackInputSchema = z
  .object({
    consent: z.literal(true, { error: '请先确认自愿提交反馈。' }),
    kind: FeedbackKindSchema,
    text: FeedbackTextSchema,
    sessionId: z.string().uuid().optional(),
  })
  .strict()
const FeedbackPayloadSchema = FeedbackInputSchema.omit({ sessionId: true })
  .extend({ schemaVersion: z.literal('feedback-v1') })
  .strict()
export type FeedbackView = { kind: z.infer<typeof FeedbackKindSchema>; text: string; createdAt: string }

export class FeedbackService {
  constructor(readonly store: Store) {}

  submit(identity: Identity, raw: unknown) {
    const input = FeedbackInputSchema.parse(raw)
    return this.store.transaction(() => {
      invariant(
        this.store.get('SELECT id FROM users WHERE id=?', identity.user.id),
        'UNAUTHORIZED',
        401,
        '请重新进入游客模式或登录。',
      )
      if (input.sessionId)
        invariant(
          this.store.get(
            'SELECT id FROM sessions WHERE id=? AND owner_id=?',
            input.sessionId,
            identity.user.id,
          ),
          'SESSION_NOT_FOUND',
          404,
          '关联旅程不存在或不属于当前身份。',
        )
      const feedbackId = id(),
        createdAt = now()
      // The existing text column stores only the explicit submission envelope.
      // Never copy conversation, journal, auth or device data into feedback.
      const payload = FeedbackPayloadSchema.parse({
        schemaVersion: 'feedback-v1',
        consent: true,
        kind: input.kind,
        text: input.text,
      })
      this.store.run(
        'INSERT INTO feedback (id,owner_id,session_id,text,created_at) VALUES (?,?,?,?,?)',
        feedbackId,
        identity.user.id,
        input.sessionId ?? null,
        JSON.stringify(payload),
        createdAt,
      )
      return { id: feedbackId, createdAt }
    })
  }

  list(identity: Identity): { items: FeedbackView[]; limit: number } {
    new AuthService(this.store).requireRole(identity, ['editor', 'reviewer', 'admin'])
    const rows = this.store.all<{ text: string; created_at: string }>(
      'SELECT text,created_at FROM feedback ORDER BY created_at DESC,rowid DESC LIMIT 100',
    )
    const items: FeedbackView[] = []
    for (const row of rows) {
      // Legacy/imported plain text is not proof of consent. Do not expose it.
      let decoded: unknown
      try {
        decoded = JSON.parse(row.text)
      } catch {
        continue
      }
      const parsed = FeedbackPayloadSchema.safeParse(decoded)
      if (parsed.success)
        items.push({ kind: parsed.data.kind, text: parsed.data.text, createdAt: row.created_at })
    }
    return { items, limit: 100 }
  }
}
