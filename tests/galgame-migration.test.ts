import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrationSql, galgameMigrationSql } from '../packages/database/migration'
import { canonical, hash, now, Store } from '../packages/database'
import { legacyPack } from '../packages/content/seed-v1'

describe('增量数据库迁移', () => {
  it.each([true, false])('0001既有内容与存档获得story默认模式，重复启动不重跑0002（已有迁移记录：%s）', ledger => {
    const directory = mkdtempSync(join(tmpdir(), 'careerscape-upgrade-')),
      path = join(directory, 'old.sqlite')
    const old = new Database(path),
      stamp = now()
    old.exec(migrationSql)
    expect(old.prepare("SELECT name FROM sqlite_master WHERE name='schema_migrations'").get()).toBeUndefined()
    if (ledger) {
      old.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,applied_at TEXT NOT NULL)')
      old.prepare('INSERT INTO schema_migrations VALUES (?,?)').run('0001', stamp)
    }
    old.prepare('INSERT INTO users VALUES (?,?,?,?,?)').run('old-user', null, null, 1, stamp)
    old
      .prepare('INSERT INTO packs VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(
        legacyPack.id,
        '1',
        'v1',
        'build',
        legacyPack.assetManifestVersion,
        JSON.stringify(legacyPack),
        hash(canonical(legacyPack)),
        'published',
        'pending',
        1,
        stamp,
      )
    old
      .prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)')
      .run('old-session', 'old-user', 'old-title', legacyPack.id, '1', 'old-branch', stamp, stamp)
    old.close()
    try {
      const upgraded = new Store(path)
      expect(upgraded.get<{ mode: string }>('SELECT mode FROM sessions')?.mode).toBe('story')
      expect(upgraded.get<{ mode: string }>('SELECT mode FROM packs')?.mode).toBe('story')
      expect(upgraded.all('SELECT version FROM schema_migrations')).toHaveLength(2)
      upgraded.close()
      const reopened = new Store(path)
      expect(reopened.get<{ n: number }>('SELECT COUNT(*) n FROM sessions')?.n).toBe(1)
      reopened.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('迁移SQL文件与运行时内嵌版本一致', () => {
    expect(readFileSync('packages/database/migrations/0002_galgame.sql', 'utf8').trim()).toBe(
      galgameMigrationSql.trim(),
    )
  })
})
