import { demoPack } from '../../packages/content/seed'
import { BatchSchema, planBatch, runBatch, validateBatch, type ContentBatch } from '../../packages/content/pipeline'
import { validatePack, assemble } from '../../packages/narrative/engine'
import { Store, canonical, hash } from '../../packages/database'
import { checkAssets } from '../../apps/web/server/services/content'

const command = process.argv[2] ?? 'plan'
const dryRun = process.argv.includes('--dry-run')
const option = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
const maxTokens = option('max-tokens') === undefined ? undefined : Number(option('max-tokens'))
if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 0)) throw new Error('--max-tokens 必须为非负整数')

function saveBatch(store: Store, batch: ContentBatch) {
  store.transaction(() => {
    store.run('INSERT INTO content_batches VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor,budget=excluded.budget,status=excluded.status,payload=excluded.payload', batch.id, String(batch.profileVersion), batch.configHash, batch.cursor, JSON.stringify(batch.budget), batch.status, JSON.stringify(batch))
    store.run('INSERT OR IGNORE INTO occupation_profiles VALUES (?,?,?,?)', demoPack.profile.id, String(demoPack.profileVersion), JSON.stringify(demoPack.profile), 'draft')
    for (const item of batch.items) {
      if (!item.candidate) continue
      const candidate = item.candidate
      // Reviewed and published templates are never overwritten by a retry.
      store.run("INSERT INTO templates VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id,version) DO UPDATE SET payload=excluded.payload,hash=excluded.hash,content_status=excluded.content_status WHERE templates.content_status IN ('draft','auto_checked')", candidate.id, String(candidate.version), 'event', candidate.profileId, String(candidate.profileVersion), JSON.stringify(candidate.sourceFactIds), JSON.stringify(candidate), hash(canonical(candidate)), candidate.contentStatus, candidate.domainReviewStatus, batch.id)
    }
    store.audit(null, `content.batch_${command}`, batch.id, { provider: batch.provider, status: batch.status, cursor: batch.cursor, tokens: batch.budget.usedTokens })
  })
}

async function main() {
  const plan = planBatch(demoPack, { ...(maxTokens === undefined ? {} : { maxTokens }), ...(option('variant') ? { variant: option('variant') } : {}) })
  if (dryRun) {
    const validation = validatePack(demoPack)
    print({ command, dryRun: true, batchId: plan.id, provider: 'mock', quota: plan.quota, estimatedTokens: plan.items.reduce((sum, item) => sum + item.estimatedTokens, 0), estimatedCostUSD: 0, budget: plan.budget, validation, assetGate: checkAssets(demoPack), seedPreview: assemble(demoPack, option('seed') ?? 'preview').slotMapping, note: 'dry-run 不写入数据库、不调用模型、不发布；美术资源仍须独立门禁。' }); return
  }
  if (command === 'publish') {
    const raw = process.env.CONTENT_SESSION_COOKIE
    if (!raw) throw new Error('发布需要现有管理员会话。请在后台审核发布；CLI 可通过受保护环境变量 CONTENT_SESSION_COOKIE 使用已有会话，不接受自报管理员 ID。')
    const base = process.env.APP_ORIGIN ?? 'http://127.0.0.1:3000'
    const url = new URL(base)
    if (!['https:', 'http:'].includes(url.protocol) || (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('远程发布只能使用 HTTPS')
    const cookie = `careerscape_session=${raw}`
    const meResponse = await fetch(`${url.origin}/api/me`, { headers: { cookie } })
    const me = await meResponse.json() as { user?: { roles: string[] }; csrfToken?: string }
    if (!me.user?.roles.includes('admin') || !me.csrfToken) throw new Error('当前会话没有管理员发布权限')
    const response = await fetch(`${url.origin}/api/admin/content`, { method: 'POST', headers: { cookie, origin: url.origin, 'x-csrf-token': me.csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'publish', packId: option('pack') ?? demoPack.id, version: Number(option('version') ?? demoPack.version), reason: 'CLI 发布已审核内容；权限与资源门禁由服务端复核' }) })
    if (!response.ok) throw new Error(`发布未完成，服务端返回 ${response.status}；请在后台查看审核与资源门禁`)
    print({ published: true, result: await response.json() }); return
  }
  if (!['plan', 'generate', 'validate'].includes(command)) throw new Error('命令仅支持 plan/generate/validate/publish')
  const store = new Store()
  try {
    const requestedId = option('batch') ?? plan.id
    const row = store.get<{ payload: string }>('SELECT payload FROM content_batches WHERE id=?', requestedId)
    if (option('batch') && !row) throw new Error('指定批次不存在')
    let batch = row ? BatchSchema.parse(JSON.parse(row.payload)) : plan
    if (maxTokens !== undefined) batch.budget.maxTokens = maxTokens
    if (command === 'generate') batch = await runBatch(batch, demoPack)
    if (command === 'validate') batch = validateBatch(batch, demoPack)
    saveBatch(store, batch)
    print({ batchId: batch.id, status: batch.status, provider: batch.provider, cursor: batch.cursor, total: batch.items.length, budget: batch.budget, items: batch.items.map(item => ({ key: item.key, status: item.status, errors: item.errors })), ...(command === 'validate' ? { packValidation: validatePack(demoPack), assetGate: checkAssets(demoPack) } : {}), note: '候选仍未发布。智能体结构检查不等于行业人工审核；mock 没有调用真实生成模型。' })
  } finally { store.close() }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'content command failed'}\n`); process.exitCode = 1 })
