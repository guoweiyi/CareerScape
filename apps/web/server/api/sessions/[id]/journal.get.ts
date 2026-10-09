import { getRouterParam, getQuery } from 'h3'
import { endpoint, identity, services } from '../../../utils/api'
export default endpoint(event => services().sessions.journal(identity(event).user.id, getRouterParam(event, 'id')!, typeof getQuery(event).branchId === 'string' ? String(getQuery(event).branchId) : undefined))
