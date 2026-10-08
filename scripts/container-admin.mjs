import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const username = process.argv[2]?.trim().toLowerCase()
if (!username || !/^[a-z0-9_]{3,32}$/.test(username) || process.argv.length !== 3) {
  console.error('Usage: node /app/server/container-admin.mjs <existing-registered-username>')
  process.exit(1)
}

// Operator-only container CLI: no account creation, passwords, migrations or player data reads.
const database = new Database(process.env.DATABASE_PATH || '/data/careerscape.sqlite', { fileMustExist: true })
try {
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  const user = database.prepare('SELECT id FROM users WHERE username=? AND is_guest=0').get(username)
  if (!user) throw new Error('Register a normal account in the website before granting content roles.')
  const roles = ['editor', 'reviewer', 'admin']
  database.transaction(() => {
    const grant = database.prepare('INSERT OR IGNORE INTO user_roles VALUES (?,?)')
    for (const role of roles) grant.run(user.id, role)
    database.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?)').run(
      randomUUID(), null, 'role.bootstrap', user.id,
      JSON.stringify({ roles, method: 'container operator CLI' }), new Date().toISOString(),
    )
  }).immediate()
  console.log('Granted editor, reviewer and admin roles to the existing account; audit recorded.')
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Container administration failed.')
  process.exitCode = 1
} finally {
  database.close()
}
