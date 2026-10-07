import { getRouterParam } from 'h3'
import { endpoint, identity, services, body } from '../../../utils/api'
export default endpoint(async event => services().game.fork(identity(event).user.id, getRouterParam(event, 'id')!, await body(event)))
