import { endpoint, identity, services } from '../../utils/api'
export default endpoint(event => services().auth.export(identity(event).user.id))
