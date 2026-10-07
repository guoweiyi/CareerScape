import { z } from 'zod'
import { endpoint, identity, services, clearAuth, body } from '../../utils/api'
export default endpoint(async event => { const who = identity(event); z.object({ confirm: z.literal('DELETE') }).strict().parse(await body(event)); services().auth.delete(who.user.id); clearAuth(event); return { ok: true, backupRetentionDays: 30 } })
