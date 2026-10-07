import {endpoint,identity,services,body} from '../../utils/api'
import {BatchService} from '../../services/batches'
export default endpoint(async event=>new BatchService(services().store).preview(identity(event),await body(event)))
