import { endpoint, identity, services } from '../../utils/api'
export default endpoint(event => services().content.overview(identity(event)))
