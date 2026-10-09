import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Store, hash, now } from '../packages/database'
import { ContentService } from '../apps/web/server/services/content'
import { GalgameContentService } from '../apps/web/server/services/galgame-content'

const command = process.argv[2] || 'migrate'
const sourcePath = resolve(process.env.DATABASE_PATH || '.data/careerscape.sqlite')
const store = new Store(sourcePath)
function foreignKeyErrorCount(database:Store){
  const result:unknown=database.sql.pragma('foreign_key_check')
  if(!Array.isArray(result))throw new Error('SQLite外键检查返回了未知格式。')
  return result.length
}
try {
  if (command === 'migrate') console.log(JSON.stringify({ status: 'migrated', schemaVersion: '0002', integrity: store.sql.pragma('integrity_check', { simple: true }) }))
  else if (command === 'seed') { const result = new ContentService(store).seed(); new GalgameContentService(store).seed(); console.log(JSON.stringify(result, null, 2)) }
  else if (command === 'bootstrap-admin') {
    const username = process.argv[3]?.toLowerCase()
    if (!username) throw new Error('用法: pnpm exec tsx scripts/db.ts bootstrap-admin <已注册用户名>')
    const user = store.get<{id:string}>('SELECT id FROM users WHERE username=? AND is_guest=0', username)
    if (!user) throw new Error('请先通过网页注册正式账号，再由服务器操作者授予后台角色。')
    store.transaction(() => { for (const role of ['editor','reviewer','admin']) store.run('INSERT OR IGNORE INTO user_roles VALUES (?,?)',user.id,role);store.audit(null,'role.bootstrap',user.id,{roles:['editor','reviewer','admin'],method:'local operator CLI'}) })
    console.log('已授予现有账号三个独立的内容角色。重新载入账号页面即可。')
  } else if (command === 'backup') {
    const destination = resolve(process.argv[3] || `.data/backups/careerscape-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`)
    if (existsSync(destination)) throw new Error('备份目标已存在，拒绝覆盖。')
    mkdirSync(dirname(destination),{recursive:true})
    await store.sql.backup(destination)
    const check = new Store(destination)
    try {
      if (check.sql.pragma('integrity_check',{simple:true}) !== 'ok' || foreignKeyErrorCount(check)) throw new Error('备份完整性检查失败')
      const manifest={schemaVersion:'0002',createdAt:now(),sha256:createHash('sha256').update(readFileSync(destination)).digest('hex'),tableCounts:Object.fromEntries(['users','sessions','branches','event_logs','snapshots'].map(table=>[table,check.get<{n:number}>(`SELECT COUNT(*) n FROM ${table}`)!.n])),retentionDays:30,containsPersonalData:true}
      writeFileSync(`${destination}.manifest.json`,JSON.stringify(manifest,null,2))
      console.log(JSON.stringify({status:'backup_verified',destination,...manifest}))
    } finally {check.close()}
  } else if (command === 'restore-verify') {
    const backup = process.argv[3] && resolve(process.argv[3])
    if (!backup || !existsSync(backup)) throw new Error('用法: pnpm exec tsx scripts/db.ts restore-verify <backup.sqlite> [新目标文件]')
    const destination = resolve(process.argv[4] || `.data/restore-${Date.now()}.sqlite`)
    if (existsSync(destination)) throw new Error('恢复只允许写入不存在的新文件；不会覆盖在线数据库。')
    const manifestPath=`${backup}.manifest.json`
    if (!existsSync(manifestPath)) throw new Error('缺少备份校验清单，拒绝恢复。')
    const manifest=JSON.parse(readFileSync(manifestPath,'utf8')) as {sha256:string}
    if (createHash('sha256').update(readFileSync(backup)).digest('hex')!==manifest.sha256) throw new Error('备份哈希不匹配。')
    mkdirSync(dirname(destination),{recursive:true});copyFileSync(backup,destination)
    const restored=new Store(destination)
    try {
      const deletions=new Set(store.all<{user_hash:string}>('SELECT user_hash FROM account_deletions').map(d=>d.user_hash))
      let reapplied=0
      restored.transaction(()=>{for(const user of restored.all<{id:string}>('SELECT id FROM users'))if(deletions.has(hash(user.id))){restored.run('DELETE FROM users WHERE id=?',user.id);restored.run('INSERT OR IGNORE INTO account_deletions VALUES (?,?)',hash(user.id),now());reapplied++}})
      if(restored.sql.pragma('integrity_check',{simple:true})!=='ok'||foreignKeyErrorCount(restored))throw new Error('恢复后完整性检查失败。')
      console.log(JSON.stringify({status:'restore_verified',destination,reappliedDeletions:reapplied,liveDatabaseReplaced:false,events:restored.get<{n:number}>('SELECT COUNT(*) n FROM event_logs')!.n}))
    }finally{restored.close()}
  } else throw new Error(`未知命令:${command}`)
} finally {store.close()}
