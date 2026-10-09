import { getQuery } from 'h3'
import { z } from 'zod'
import { endpoint, identity, services } from '../../utils/api'
export default endpoint(event => services().auth.export(identity(event).user.id, z.object({ sessionId: z.string().min(1).max(100).optional() }).parse(getQuery(event)).sessionId))
