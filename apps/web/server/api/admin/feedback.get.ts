import { endpoint, identity, services } from '../../utils/api'
import { FeedbackService } from '../../services/feedback'

export default endpoint((event) => new FeedbackService(services().store).list(identity(event)))
