import { getRouterParam, getQuery } from 'h3'
import { z } from 'zod'
import { endpoint, identity, services } from '../../../utils/api'
export default endpoint(event => services().game.turn(identity(event).user.id, getRouterParam(event, 'id')!, z.string().min(8).max(80).parse(getQuery(event).clientActionId)))
