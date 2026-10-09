import {getQuery,getRouterParam} from 'h3'
import {z} from 'zod'
import {endpoint,identity,services} from '../../../utils/api'
export default endpoint(event=>{const query=z.object({branchId:z.string().max(100),beforeEventSeq:z.coerce.number().int().positive().optional()}).parse(getQuery(event));return services().sessions.history(identity(event).user.id,getRouterParam(event,'id')!,query.branchId,query.beforeEventSeq)})
