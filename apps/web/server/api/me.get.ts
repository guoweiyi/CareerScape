import { endpoint, optionalIdentity } from '../utils/api'
export default endpoint(event => { const who = optionalIdentity(event); return { user: who?.user || null, csrfToken: who?.csrfToken || null } })
