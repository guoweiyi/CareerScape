import { endpoint, services } from '../utils/api'
export default endpoint(() => ({ status: services().store.get('SELECT 1') ? 'ok' : 'unavailable', schemaVersion: '0001' }))
