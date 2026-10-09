import { ArchiveService } from '../../services/archive'
import { body, endpoint, identity, services } from '../../utils/api'

export default endpoint(async event => new ArchiveService(services().store).import(identity(event).user.id, await body(event, 16 * 1024 * 1024)))
