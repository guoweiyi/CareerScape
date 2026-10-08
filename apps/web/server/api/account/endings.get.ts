import { EndingsService } from '../../services/endings'
import { endpoint, identity, services } from '../../utils/api'

export default endpoint((event) => new EndingsService(services().store).list(identity(event).user.id))
