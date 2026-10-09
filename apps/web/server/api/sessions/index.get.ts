import { endpoint, identity, services } from '../../utils/api'
export default endpoint(event => services().sessions.list(identity(event).user.id))
