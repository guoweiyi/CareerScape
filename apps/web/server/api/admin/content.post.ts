import { endpoint, identity, services, body } from '../../utils/api'
export default endpoint(async event => services().content.mutate(identity(event), await body(event)))
