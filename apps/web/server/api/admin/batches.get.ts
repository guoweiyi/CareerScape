import {endpoint,identity,services} from '../../utils/api'
import {BatchService} from '../../services/batches'
export default endpoint(event=>new BatchService(services().store).list(identity(event)))
