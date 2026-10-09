import { endpoint, services } from '../utils/api'
export default endpoint(() => {
  const store = services().store
  return {
    status: store.get('SELECT 1') ? 'ok' : 'unavailable',
    schemaVersion: store.get<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')?.version,
  }
})
