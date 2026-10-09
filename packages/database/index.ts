import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import * as schema from './schema'
import { migrationSql, galgameMigrationSql } from './migration'

export const now = () => new Date().toISOString()
export const id = () => randomUUID()
export const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export class Store {
  readonly sql: Database.Database
  readonly db: ReturnType<typeof drizzle<typeof schema>>
  constructor(path = process.env.DATABASE_PATH || defaultDatabasePath()) {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })
    this.sql = new Database(path)
    this.sql.pragma('foreign_keys = ON')
    this.sql.pragma('journal_mode = WAL')
    this.sql.pragma('busy_timeout = 5000')
    this.db = drizzle(this.sql, { schema })
    this.sql.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    this.sql.transaction(() => {
      for (const [version, sql] of [['0001', migrationSql], ['0002', galgameMigrationSql]]) {
        if (!this.sql.prepare('SELECT version FROM schema_migrations WHERE version=?').get(version)) {
          this.sql.exec(sql!)
          this.sql.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(version, now())
        }
      }
    }).immediate()
  }
  get<T>(sql: string, ...args: unknown[]): T | undefined { return this.sql.prepare(sql).get(...args) as T | undefined }
  all<T>(sql: string, ...args: unknown[]): T[] { return this.sql.prepare(sql).all(...args) as T[] }
  run(sql: string, ...args: unknown[]) { return this.sql.prepare(sql).run(...args) }
  transaction<T>(fn: () => T): T { return this.sql.transaction(fn).immediate() }
  audit(actorId: string | null, action: string, resourceId: string, metadata: Record<string, unknown> = {}) {
    this.run('INSERT INTO audit_logs VALUES (?,?,?,?,?,?)', id(), actorId, action, resourceId, JSON.stringify(metadata), now())
  }
  close() { this.sql.close() }
}

function defaultDatabasePath(){
  const cwd=process.cwd(),parent=resolve(cwd,'../..')
  const root=existsSync(resolve(cwd,'packages/database'))?cwd:existsSync(resolve(parent,'packages/database'))?parent:cwd
  return resolve(root,'.data/careerscape.sqlite')
}

export class AppError extends Error {
  constructor(public code: string, public statusCode: number, message: string) { super(message) }
}
export function invariant(condition: unknown, code: string, status: number, message: string): asserts condition {
  if (!condition) throw new AppError(code, status, message)
}
