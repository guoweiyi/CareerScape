import { endpoint, services } from '../utils/api'
export default endpoint(() => ({ ...services().content.catalog(), galgame: services().galgame.content.catalog() }))
