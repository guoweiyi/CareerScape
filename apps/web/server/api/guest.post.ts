import { endpoint, optionalIdentity, services, authResponse } from '../utils/api'
import {getRequestIP} from 'h3'
export default endpoint(event => {const existing=optionalIdentity(event);if(!existing)services().auth.rateLimit(`guest:${getRequestIP(event)||'unknown'}`,60);return authResponse(event, services().auth.guest(existing))})
