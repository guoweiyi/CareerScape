import { endpoint, optionalIdentity, services, authResponse, body } from '../../utils/api'
import { getRequestIP } from 'h3'
export default endpoint(async event => { services().auth.rateLimit(`register:${getRequestIP(event) || 'unknown'}`, 20); return authResponse(event, await services().auth.register(await body(event), optionalIdentity(event))) })
