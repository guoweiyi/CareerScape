import {
  ContentPackSchema,
  WorldStateSchema,
  type ContentPack,
  type WorldState,
} from '../../../../packages/contracts'
import { invariant, type Store } from '../../../../packages/database'

export type UnlockedEndingDTO = {
  endingId: NonNullable<WorldState['endingId']>
  title: string
  summary: string
  firstCompletedAt: string
  sessionId: string
  branchId: string
  packVersion: number
}
export type EndingsDTO = {
  packs: { packId: string; title: string; totalEndings: number; unlocked: UnlockedEndingDTO[] }[]
}

type OwnedSession = { id: string; pack_id: string; pack_version: string; manifest: string }
type CompletionRow = { session_id: string; branch_id: string; state_after: string; created_at: string }

/** A read-only projection of committed history, never a separate achievement ledger. */
export class EndingsService {
  constructor(readonly store: Store) {}

  list(userId: string): EndingsDTO {
    return this.store.sql
      .transaction(() => {
        const sessions = this.store.all<OwnedSession>(
          `
        SELECT s.id,s.pack_id,s.pack_version,p.manifest
        FROM sessions s JOIN packs p ON p.id=s.pack_id AND p.version=s.pack_version
        WHERE s.owner_id=? ORDER BY s.updated_at DESC,s.created_at DESC,s.id
      `,
          userId,
        )
        const bySession = new Map<string, ContentPack>()
        const versions = new Map<string, ContentPack>()
        const groups = new Map<
          string,
          { title: string; endingIds: Set<string>; unlocked: Map<string, UnlockedEndingDTO> }
        >()
        for (const session of sessions) {
          const versionKey = JSON.stringify([session.pack_id, session.pack_version])
          let pack = versions.get(versionKey)
          if (!pack) {
            pack = ContentPackSchema.parse(JSON.parse(session.manifest))
            invariant(
              pack.id === session.pack_id && String(pack.version) === session.pack_version,
              'PACK_VERSION_MISMATCH',
              409,
              '历史内容版本不一致，暂时无法回顾。',
            )
            versions.set(versionKey, pack)
          }
          bySession.set(session.id, pack)
          let group = groups.get(pack.id)
          if (!group) {
            group = { title: pack.title, endingIds: new Set(), unlocked: new Map() }
            groups.set(pack.id, group)
          }
          // Count only endings in the owner's frozen versions. Unknown titles/IDs stay server-side.
          for (const node of pack.nodes)
            if (node.nodeType === 'ending' && node.metadata.endingId)
              group.endingIds.add(node.metadata.endingId)
        }
        // No message payload, journal, mutable branch state, turn draft or client claim is read.
        // Chat/explanation after an ending cannot create a new completion or alter its time.
        const completions = this.store.all<CompletionRow>(
          `
        SELECT e.session_id,e.branch_id,e.state_after,e.created_at
        FROM event_logs e
        JOIN sessions s ON s.id=e.session_id
        JOIN branches b ON b.id=e.branch_id AND b.session_id=s.id
        WHERE s.owner_id=? AND e.kind IN ('choice','leave') AND e.channel='group'
        ORDER BY e.created_at,e.event_seq,e.id
      `,
          userId,
        )
        for (const event of completions) {
          const pack = bySession.get(event.session_id)
          if (!pack) continue
          const state = WorldStateSchema.parse(JSON.parse(event.state_after))
          if (!state.endingId) continue
          const node = pack.nodes.find(
            (candidate) =>
              candidate.nodeId === state.nodeId &&
              candidate.nodeType === 'ending' &&
              candidate.metadata.endingId === state.endingId,
          )
          if (!node) continue
          const group = groups.get(pack.id)!
          const previous = group.unlocked.get(state.endingId)
          const summary =
            node.messages.find((message) => message.speakerId === 'narrator')?.text ||
            node.metadata.explanation
          group.unlocked.set(state.endingId, {
            endingId: state.endingId,
            title: node.title,
            summary: Array.from(summary).slice(0, 240).join(''),
            firstCompletedAt: previous?.firstCompletedAt ?? event.created_at,
            sessionId: event.session_id,
            branchId: event.branch_id,
            packVersion: pack.version,
          })
        }
        return {
          packs: [...groups].map(([packId, group]) => ({
            packId,
            title: group.title,
            totalEndings: group.endingIds.size,
            unlocked: [...group.unlocked.values()],
          })),
        }
      })
      .deferred()
  }
}
