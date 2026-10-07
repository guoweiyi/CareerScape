import { endpoint, identity, services, body } from '../utils/api'
import { FeedbackService } from '../services/feedback'

export default endpoint(async (event) => {
  const who = identity(event)
  return new FeedbackService(services().store).submit(who, await body(event))
})
