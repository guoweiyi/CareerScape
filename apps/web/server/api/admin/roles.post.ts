import { z } from 'zod'
import { endpoint, identity, services, body } from '../../utils/api'
import { invariant } from '../../../../../packages/database'
export default endpoint(async event => {
  const who = identity(event), { auth, store } = services(); auth.requireRole(who, ['admin'])
  const input = z.object({ userId: z.string().max(100), role: z.enum(['editor', 'reviewer', 'admin']), enabled: z.boolean() }).strict().parse(await body(event))
  invariant(store.get('SELECT id FROM users WHERE id=? AND is_guest=0', input.userId), 'USER_NOT_FOUND', 404, '正式账号不存在。')
  invariant(input.enabled || input.userId !== who.user.id || input.role !== 'admin', 'SELF_DEMOTION_REJECTED', 409, '不能移除当前管理员自己的管理员权限。')
  store.transaction(() => { if (input.enabled) store.run('INSERT OR IGNORE INTO user_roles VALUES (?,?)', input.userId, input.role); else store.run('DELETE FROM user_roles WHERE user_id=? AND role=?', input.userId, input.role); store.audit(who.user.id, 'role.update', input.userId, { role: input.role, enabled: input.enabled }) })
  return { ok: true }
})
