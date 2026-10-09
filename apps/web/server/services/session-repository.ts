import { z } from 'zod'
import { canonical, hash, id, invariant, now, type Store } from '../../../../packages/database'

export type SessionRow = {
  id: string
  owner_id: string
  title: string
  pack_id: string
  pack_version: string
  current_branch_id: string
  created_at: string
  updated_at: string
  mode: 'story' | 'galgame'
}
export type BranchRow = {
  id: string
  session_id: string
  parent_branch_id: string | null
  fork_event_seq: number
  revision: number
  state: string
  created_at: string
}
export type EventRow = {
  id: string
  session_id: string
  branch_id: string
  event_seq: number
  kind: string
  actor: string
  channel: string
  recipient_id: string | null
  payload: string
  state_after: string
  created_at: string
}
export type TurnRow = {
  id: string
  request_hash: string
  lease_token: string
  lease_until: number
  status: string
  branch_id: string
}
type ActionIdentity = { clientActionId: string; expectedRevision: number; branchId: string; kind: string }

/** Shared ownership, lineage and durable action leases for both narrative modes. */
export class SessionRepository {
  constructor(readonly store: Store) {}
  owned(userId: string, sessionId: string, mode?: SessionRow['mode']) {
    const row = this.store.get<SessionRow>(
      'SELECT * FROM sessions WHERE id=? AND owner_id=?',
      sessionId,
      userId,
    )
    invariant(row && (!mode || row.mode === mode), 'SESSION_NOT_FOUND', 404, '存档不存在或不属于当前账号。')
    return row
  }
  branch(sessionId: string, branchId: string) {
    const row = this.store.get<BranchRow>(
      'SELECT * FROM branches WHERE id=? AND session_id=?',
      branchId,
      sessionId,
    )
    invariant(row, 'BRANCH_NOT_FOUND', 404, '路线不存在。')
    return row
  }
  lineage(sessionId: string, branchId: string, depth = 0): EventRow[] {
    invariant(depth < 100, 'BRANCH_DEPTH', 409, '路线层数过多，请从较早路线继续。')
    const branch = this.branch(sessionId, branchId)
    const prefix = branch.parent_branch_id
      ? this.lineage(sessionId, branch.parent_branch_id, depth + 1).filter(
          (e) => e.event_seq <= branch.fork_event_seq,
        )
      : []
    return [
      ...prefix,
      ...this.store.all<EventRow>(
        'SELECT * FROM event_logs WHERE session_id=? AND branch_id=? ORDER BY event_seq',
        sessionId,
        branchId,
      ),
    ]
  }
  journal(userId: string, sessionId: string, branchId?: string, text?: string) {
    const session = this.owned(userId, sessionId),
      branch = this.branch(sessionId, branchId || session.current_branch_id)
    if (text !== undefined) {
      z.string().max(10000).parse(text)
      this.store.run(
        'INSERT INTO journals VALUES (?,?,?,?) ON CONFLICT(session_id,branch_id) DO UPDATE SET text=excluded.text,updated_at=excluded.updated_at',
        sessionId,
        branch.id,
        text,
        now(),
      )
    }
    return (
      this.store.get<{ text: string; updatedAt: string }>(
        'SELECT text,updated_at AS updatedAt FROM journals WHERE session_id=? AND branch_id=?',
        sessionId,
        branch.id,
      ) || { text: '', updatedAt: null }
    )
  }
  claimTurn<R>(userId: string, sessionId: string, input: ActionIdentity, leaseMs = 45000, maxRevision = 400) {
    const requestHash = hash(canonical(input)),
      turnId = hash(`${sessionId}:${input.clientActionId}`),
      lease = id()
    const prepared = this.store.transaction(() => {
      const session = this.owned(userId, sessionId)
      const receipt = this.store.get<{ request_hash: string; result: string }>(
        'SELECT * FROM action_receipts WHERE session_id=? AND client_action_id=?',
        sessionId,
        input.clientActionId,
      )
      if (receipt) {
        invariant(
          receipt.request_hash === requestHash,
          'ACTION_BODY_CONFLICT',
          409,
          '相同动作编号不能携带不同内容。',
        )
        return { receipt: JSON.parse(receipt.result) as R }
      }
      const prior = this.store.get<TurnRow>(
        'SELECT * FROM turns WHERE session_id=? AND client_action_id=?',
        sessionId,
        input.clientActionId,
      )
      if (prior) {
        invariant(
          prior.request_hash === requestHash,
          'ACTION_BODY_CONFLICT',
          409,
          '相同动作编号不能携带不同内容。',
        )
        invariant(
          prior.status !== 'running' || prior.lease_until < Date.now(),
          'TURN_RUNNING',
          409,
          '动作正在处理中，请查询回合状态。',
        )
      }
      const branch = this.branch(sessionId, input.branchId)
      invariant(
        branch.revision === input.expectedRevision,
        'REVISION_CONFLICT',
        409,
        '存档已在另一页面更新，请刷新后选择。',
      )
      invariant(
        !this.store.get(
          'SELECT id FROM turns WHERE session_id=? AND branch_id=? AND client_action_id<>? AND status=? AND lease_until>?',
          sessionId,
          input.branchId,
          input.clientActionId,
          'running',
          Date.now(),
        ),
        'TURN_RUNNING',
        409,
        '当前路线已有动作正在生成，请等待完成。',
      )
      invariant(
        branch.revision < maxRevision || ['leave', 'debrief'].includes(input.kind),
        'TURN_LIMIT',
        409,
        '本路线已达回合上限，请结束或复盘。',
      )
      const stamp = now()
      this.store.run(
        'INSERT INTO turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(session_id,client_action_id) DO UPDATE SET status=excluded.status,lease_token=excluded.lease_token,lease_until=excluded.lease_until,failure_code=NULL,updated_at=excluded.updated_at',
        turnId,
        sessionId,
        branch.id,
        input.clientActionId,
        requestHash,
        input.expectedRevision,
        'running',
        lease,
        Date.now() + leaseMs,
        null,
        stamp,
        stamp,
      )
      return { session, branch }
    })
    return { prepared, turnId, lease, requestHash }
  }
  assertTurnCommit(userId: string, sessionId: string, input: ActionIdentity, turnId: string, lease: string) {
    this.owned(userId, sessionId)
    const branch = this.branch(sessionId, input.branchId),
      turn = this.store.get<TurnRow>('SELECT * FROM turns WHERE id=?', turnId)
    invariant(
      turn?.lease_token === lease && turn.status === 'running' && turn.lease_until > Date.now(),
      'LEASE_LOST',
      409,
      '生成租约已过期，请查询回合后重试。',
    )
    invariant(
      branch.revision === input.expectedRevision,
      'REVISION_CONFLICT',
      409,
      '另一个动作先完成，当前结果未提交。',
    )
    return branch
  }
}
