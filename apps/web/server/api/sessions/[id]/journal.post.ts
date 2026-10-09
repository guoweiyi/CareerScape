import { getRouterParam } from 'h3'
import { z } from 'zod'
import { endpoint, identity, services, body } from '../../../utils/api'
export default endpoint(async event => { const input = z.object({ text: z.string().max(10000), branchId: z.string().max(100).optional() }).strict().parse(await body(event)); return services().sessions.journal(identity(event).user.id, getRouterParam(event, 'id')!, input.branchId, input.text) })
