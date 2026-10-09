import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const image = process.argv[2]
if (!image || image.startsWith('-') || process.argv.length !== 3) {
  console.error('Usage: node scripts/docker-smoke.mjs <already-built-image>')
  process.exit(1)
}
const suffix = randomUUID().replaceAll('-', '')
const name = `careerscape-smoke-${suffix}`
const volume = `${name}-data`
let createdVolume = false
let createdContainer = false
let baseURL = ''
let cookie = ''
let csrf = ''

function docker(...args) {
  return execFileSync('docker', args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }).trim()
}
async function request(path, options = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    ...options,
    headers: {
      origin: baseURL,
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(15_000),
  })
  assert.equal(response.ok, true, `${options.method || 'GET'} ${path}: HTTP ${response.status}`)
  const issued = response.headers.getSetCookie().find(value => value.startsWith('careerscape_session='))
  if (issued) cookie = issued.split(';')[0]
  return response
}
async function json(path, body) {
  const response = await request(path, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })
  const value = await response.json()
  if (value.csrfToken) csrf = value.csrfToken
  return value
}
async function healthy() {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/api/health`, { signal: AbortSignal.timeout(2000) })
      if (response.ok && (await response.json()).status === 'ok') {
        const state = docker('inspect', '--format', '{{.State.Health.Status}}', name)
        if (state === 'healthy') return
      }
    } catch { /* Startup or restart still in progress. */ }
    await delay(1000)
  }
  throw new Error('Container did not become healthy within 90 seconds.')
}
async function start() {
  createdContainer = true
  docker('run', '--detach', '--name', name, '--init', '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--publish', '127.0.0.1::3000',
    '--mount', `type=volume,source=${volume},target=/data`,
    '--env', 'AI_PROVIDER=mock', '--env', 'COOKIE_SECURE=false', image)
  refreshPublishedPort()
  await healthy()
  assert.equal(docker('exec', name, 'node', '-e', 'console.log(process.getuid())'), '1000')
}
function refreshPublishedPort() {
  const mapping = docker('port', name, '3000/tcp')
  const port = mapping.match(/^127\.0\.0\.1:(\d+)$/)?.[1]
  assert.ok(port, 'Smoke container must bind only to loopback.')
  baseURL = `http://127.0.0.1:${port}`
}
async function verifyAssets() {
  const checked = new Set()
  for (const version of ['careerscape-art-v1', 'careerscape-art-v2']) {
    const manifest = await json(`/art/manifest-${version}.json`)
    assert.equal(manifest.status, 'published')
    assert.equal(manifest.version, version)
    assert.equal(manifest.assets.length, 19)
    for (const asset of manifest.assets) {
      const variants = Array.isArray(asset.variants) ? asset.variants : Object.values(asset.variants || {})
      for (const file of [asset, ...variants]) {
        assert.match(file.file, /^\/art\/[a-zA-Z0-9_.-]+\.webp$/)
        if (checked.has(file.file)) continue
        const response = await request(file.file)
        assert.match(response.headers.get('content-type') || '', /image\/webp/)
        const bytes = Buffer.from(await response.arrayBuffer())
        assert.equal(bytes.byteLength, file.bytes, `Asset byte count: ${file.id}`)
        assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Asset hash: ${file.id}`)
        checked.add(file.file)
      }
    }
  }
  console.log(`Verified both immutable art manifests and ${checked.size} unique WebP files.`)
}

try {
  docker('image', 'inspect', image)
  docker('volume', 'create', '--label', 'careerscape.purpose=isolated-smoke-test', volume)
  createdVolume = true
  await start()
  assert.match(await (await request('/')).text(), /职境漫游/)
  const catalog = await json('/api/catalog')
  assert.equal(catalog.provider, 'mock')
  const pack = catalog.occupations.find(item => item.status === 'playable')
  assert.ok(pack, 'Frozen content and art must pass the publication gate inside the standalone image.')
  const guest = await json('/api/guest', {})
  assert.equal(guest.user.isGuest, true)
  const session = await json('/api/sessions', { packId: pack.packId, seed: 'docker-smoke-fixed' })
  assert.ok(session.choices.length > 0)
  const action = {
    clientActionId: randomUUID(), expectedRevision: session.revision,
    branchId: session.branchId, kind: 'leave', channel: 'group',
  }
  const actionResponse = await request(`/api/sessions/${session.id}/action`, { method: 'POST', body: JSON.stringify(action) })
  const frames = (await actionResponse.text()).trim().split('\n').map(line => JSON.parse(line))
  assert.ok(frames.some(frame => frame.type === 'turn_committed'))
  assert.equal(frames.at(-1).type, 'stream_end')
  const username = `smoke_${suffix.slice(0, 16)}`
  const account = await json('/api/auth/register', { username, password: `smoke-password-${randomUUID()}`, claimGuest: true })
  assert.equal(account.user.id, guest.user.id)
  assert.equal(account.user.isGuest, false)
  await json(`/api/sessions/${session.id}/journal`, { branchId: session.branchId, text: 'Disposable Docker smoke journal.' })
  await verifyAssets()
  docker('exec', name, 'node', '/app/server/container-admin.mjs', username)
  const me = await json('/api/me')
  assert.deepEqual([...me.user.roles].sort(), ['admin', 'editor', 'reviewer'])
  const overview = await json('/api/admin')
  assert.ok(overview.audit.some(event => event.action === 'role.bootstrap' && event.resourceId === account.user.id))

  async function verifyPersisted() {
    assert.equal((await json('/api/me')).user.id, account.user.id)
    const saved = await json(`/api/sessions/${session.id}?branchId=${session.branchId}`)
    assert.equal(saved.state.endingId, 'handoff')
    assert.equal(saved.revision, session.revision + 1)
    const journal = await json(`/api/sessions/${session.id}/journal?branchId=${session.branchId}`)
    assert.equal(journal.text, 'Disposable Docker smoke journal.')
    const endings = await json('/api/account/endings')
    assert.equal(endings.packs[0].unlocked[0].sessionId, session.id)
    const receipt = await json(`/api/sessions/${session.id}/turn?clientActionId=${action.clientActionId}`)
    assert.equal(receipt.status, 'committed')
  }
  docker('restart', '--time', '15', name)
  // Docker may allocate a new ephemeral published port when the container restarts.
  refreshPublishedPort()
  await healthy()
  await verifyPersisted()
  console.log('Verified persisted identity, ending, journal and receipt after restart.')
  // A stopped-writer backup must restore real identity/session/journal data,
  // and an invalid checksum must fail before touching the database.
  docker('stop', '--time', '15', name)
  const databaseRun = (...args) => docker('run', '--rm', '--network', 'none',
    '--mount', `type=volume,source=${volume},target=/data`,
    '--mount', `type=volume,source=${volume},target=/backups`, '--entrypoint', 'node', image, ...args)
  databaseRun('/app/server/container-db.mjs', 'backup', '/backups/smoke-backup.sqlite')
  databaseRun('--input-type=module', '-e', "import Database from 'better-sqlite3'; const db=new Database('/data/careerscape.sqlite'); db.prepare('UPDATE journals SET text=?').run('After backup'); db.close();")
  databaseRun('--input-type=module', '-e', "import fs from 'node:fs'; const p='/backups/smoke-backup.sqlite.manifest.json'; fs.copyFileSync(p,p+'.good'); fs.writeFileSync(p,JSON.stringify({sha256:'invalid'}));")
  assert.throws(() => databaseRun('/app/server/container-db.mjs', 'restore', '/backups/smoke-backup.sqlite'))
  databaseRun('--input-type=module', '-e', "import fs from 'node:fs'; fs.copyFileSync('/backups/smoke-backup.sqlite.manifest.json.good','/backups/smoke-backup.sqlite.manifest.json');")
  databaseRun('/app/server/container-db.mjs', 'restore', '/backups/smoke-backup.sqlite')
  docker('start', name)
  refreshPublishedPort()
  await healthy()
  await verifyPersisted()
  console.log('Verified backup/restore and corrupt-checksum rejection on isolated data.')
  // Recreating the container proves data lives in the named volume, not its writable layer.
  docker('rm', '--force', name)
  createdContainer = false
  await start()
  await verifyPersisted()
  console.log('Docker smoke passed: non-root, health, SQLite, Argon2, guest claim, committed action, assets, admin audit, restart and volume recreation.')
} catch (error) {
  if (createdContainer) {
    try { console.error(docker('logs', '--tail', '100', name)) } catch { /* Preserve the original failure. */ }
  }
  console.error(error instanceof Error ? error.message : 'Docker smoke failed.')
  process.exitCode = 1
} finally {
  if (createdContainer) {
    try { docker('rm', '--force', name) } catch { process.exitCode = 1 }
  }
  if (createdVolume) {
    try { docker('volume', 'rm', volume) } catch { process.exitCode = 1 }
  }
}
