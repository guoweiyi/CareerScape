import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, copyFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [command, argument] = process.argv.slice(2)
if (!['backup', 'restore'].includes(command) || !argument || process.argv.length !== 4) {
  throw new Error('Usage: node /app/server/container-db.mjs <backup|restore> /backups/<file.sqlite>')
}
const live = process.env.DATABASE_PATH || '/data/careerscape.sqlite'
const backup = resolve(argument)
if (!backup.startsWith('/backups/')) throw new Error('Backup must be inside /backups.')
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
function verify(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true })
  try {
    if (db.pragma('integrity_check', { simple: true }) !== 'ok' || db.pragma('foreign_key_check').length) {
      throw new Error('Database integrity verification failed.')
    }
  } finally { db.close() }
}
if (command === 'backup') {
  if (existsSync(backup) || existsSync(`${backup}.manifest.json`)) throw new Error('Backup already exists.')
  mkdirSync(dirname(backup), { recursive: true })
  // Open directly: backup/restore must never apply the current application's migrations.
  const source = new Database(live, { readonly: true, fileMustExist: true })
  try { await source.backup(backup) } finally { source.close() }
  verify(backup)
  writeFileSync(`${backup}.manifest.json`, JSON.stringify({ sha256: digest(backup), createdAt: new Date().toISOString() }) + '\n', { mode: 0o600 })
  console.log('Stopped-writer backup verified.')
} else {
  const manifest = JSON.parse(readFileSync(`${backup}.manifest.json`, 'utf8'))
  if (digest(backup) !== manifest.sha256) throw new Error('Backup checksum mismatch.')
  verify(backup)
  const restored = `${live}.restore-${Date.now()}`
  copyFileSync(backup, restored)
  verify(restored)
  const quarantine = `/data/failed-${Date.now()}`
  mkdirSync(quarantine, { mode: 0o700 })
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${live}${suffix}`)) renameSync(`${live}${suffix}`, `${quarantine}/careerscape.sqlite${suffix}`)
  }
  renameSync(restored, live)
  console.log('Verified pre-release database restored; failed database retained.')
}
