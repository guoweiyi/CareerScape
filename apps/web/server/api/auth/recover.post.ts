import { endpoint, services, authResponse, body } from '../../utils/api'
import { getRequestIP } from 'h3'
export default endpoint(async event => { services().auth.rateLimit(`recover-ip:${getRequestIP(event) || 'unknown'}`, 20); return authResponse(event, await services().auth.recover(await body(event))) })
