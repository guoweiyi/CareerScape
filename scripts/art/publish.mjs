import fs from 'node:fs/promises'
import path from 'node:path'
await import('./verify.mjs')
if (process.exitCode) throw new Error('Art verification failed; publication refused')
const root = path.resolve(import.meta.dirname, '../..')
const suffix = process.argv[2] ?? (await fs.access(path.join(root, 'art/manifests/careerscape-v2.json')).then(() => 'v2', () => 'v1'))
if (!/^v[12]$/.test(suffix)) throw new Error('Expected v1 or v2')
const file = path.join(root, `art/manifests/careerscape-${suffix}.json`)
const manifest = JSON.parse(await fs.readFile(file, 'utf8'))
manifest.status = 'published'
manifest.publishedDate = '2026-10-08'
manifest.reviewedBy = 'Codex agent; no human review claimed'
const frozen = path.join(root, `apps/web/public/art/manifest-${manifest.version}.json`)
const contents = JSON.stringify(manifest, null, 2) + '\n'
const existing = await fs.readFile(frozen, 'utf8').catch(() => null)
if (existing !== null && existing !== contents) throw new Error('Immutable manifest already exists with different contents; create a new version')
if (existing === null) await fs.writeFile(frozen, contents)
await fs.writeFile(file, contents)
await fs.writeFile(path.join(root, 'apps/web/public/art/manifest.json'), contents)
console.log(`Published ${manifest.version}: ${manifest.assets.length} verified logical assets`)
