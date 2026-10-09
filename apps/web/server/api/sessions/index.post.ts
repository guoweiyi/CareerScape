import { endpoint, identity, services, body } from '../../utils/api'
export default endpoint(async event => services().sessions.create(identity(event).user.id, await body(event)))
