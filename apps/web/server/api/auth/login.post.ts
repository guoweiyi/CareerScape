import { endpoint, optionalIdentity, services, authResponse, body } from '../../utils/api'
import { getRequestIP } from 'h3'
export default endpoint(async event => { services().auth.rateLimit(`login-ip:${getRequestIP(event) || 'unknown'}`, 30); return authResponse(event, await services().auth.login(await body(event), optionalIdentity(event))) })
