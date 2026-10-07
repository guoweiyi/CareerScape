import { endpoint, identity, services } from '../../utils/api'
export default endpoint(event => services().game.list(identity(event).user.id))
