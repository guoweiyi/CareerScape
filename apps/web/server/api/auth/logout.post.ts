import { endpoint, identity, services, clearAuth } from '../../utils/api'
export default endpoint(event => { services().auth.logout(identity(event)); clearAuth(event); return { ok: true } })
