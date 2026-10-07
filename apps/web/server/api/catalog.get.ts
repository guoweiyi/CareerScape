import { endpoint, services } from '../utils/api'
export default endpoint(() => services().content.catalog())
