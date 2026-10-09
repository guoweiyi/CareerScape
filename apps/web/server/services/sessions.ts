import { z } from 'zod'
import { ActionInputSchema } from '../../../../packages/contracts'
import { GalgameActionSchema } from '../../../../packages/contracts/galgame'
import type { GameService } from './game'
import type { GalgameService } from './galgame'
import { SessionRepository } from './session-repository'
import type { Store } from '../../../../packages/database'

/** The database mode, checked after ownership, selects contracts and rules. */
export class SessionsService extends SessionRepository {
  constructor(
    store: Store,
    readonly story: GameService,
    readonly galgame: GalgameService,
  ) {
    super(store)
  }
  private service(userId: string, sessionId: string) {
    return this.owned(userId, sessionId).mode === 'galgame' ? this.galgame : this.story
  }
  parseAction(userId: string, sessionId: string, raw: unknown) {
    return this.owned(userId, sessionId).mode === 'galgame'
      ? GalgameActionSchema.parse(raw)
      : ActionInputSchema.parse(raw)
  }
  create(userId: string, raw: unknown) {
    const body = z
      .object({ mode: z.enum(['story', 'galgame']).optional() })
      .passthrough()
      .parse(raw)
    if (body.mode === 'galgame') return this.galgame.create(userId, raw)
    const { mode: _mode, ...storyInput } = body
    return this.story.create(userId, storyInput)
  }
  get(userId: string, sessionId: string, branchId?: string) {
    return this.service(userId, sessionId).get(userId, sessionId, branchId)
  }
  list(userId: string) {
    return {
      sessions: [
        ...this.story.list(userId).sessions.map((session) => ({ ...session, mode: 'story' as const })),
        ...this.galgame.list(userId),
      ].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    }
  }
  act(
    userId: string,
    sessionId: string,
    raw: unknown,
    status?: (stage: 'generating' | 'validating' | 'saving') => void,
  ) {
    return this.owned(userId, sessionId).mode === 'galgame'
      ? this.galgame.act(userId, sessionId, raw, status)
      : this.story.act(userId, sessionId, raw)
  }
  history(userId: string, sessionId: string, branchId: string, beforeEventSeq?: number) {
    return this.service(userId, sessionId).history(userId, sessionId, branchId, beforeEventSeq)
  }
  fork(userId: string, sessionId: string, raw: unknown) {
    return this.service(userId, sessionId).fork(userId, sessionId, raw)
  }
  turn(userId: string, sessionId: string, clientActionId: string) {
    return this.service(userId, sessionId).turn(userId, sessionId, clientActionId)
  }
}
