import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '../..')
const suffix = process.argv[2] ?? (await fs.access(path.join(root, 'art/manifests/careerscape-v2.json')).then(() => 'v2', () => 'v1'))
if (!/^v[12]$/.test(suffix)) throw new Error('Expected v1 or v2')
const manifestPath = path.join(root, `art/manifests/careerscape-${suffix}.json`)
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const failures = []
const checked = []
const frozenManifest = await fs.readFile(path.join(root, `apps/web/public/art/manifest-${manifest.version}.json`), 'utf8').catch(() => null)
if (frozenManifest !== null && JSON.stringify(JSON.parse(frozenManifest)) !== JSON.stringify(manifest)) failures.push('published version manifest mismatch')
const expected = [...['lin', 'zhou', 'xu'].flatMap(id => ['neutral', 'relaxed', 'thinking', 'serious'].map(exp => `chr_${id}_work_half_${exp}`)), ...['lin', 'zhou', 'xu'].map(id => `avatar_${id}_neutral`), ...['office', 'meeting', 'testing', 'terrace'].map(id => `bg_${id}_day_wide`)]
const ids = manifest.assets.map(asset => asset.id)
if (new Set(ids).size !== ids.length) failures.push('duplicate logical IDs')
for (const id of expected) if (!ids.includes(id)) failures.push(`missing ${id}`)
for (const asset of manifest.assets) {
  if (asset.reviewStatus !== 'agent-reviewed') failures.push(`unreviewed ${asset.id}`)
  if (!asset.rights.redistributionApproved || asset.rights.licenseRecordId !== 'asset-ai-2026-10-08') failures.push(`missing rights ${asset.id}`)
  for (const item of [asset, ...(Array.isArray(asset.variants) ? asset.variants : Object.values(asset.variants ?? {}))]) {
    if (!/^\/art\/[a-z0-9_]+\.[a-f0-9]{12}\.webp$/.test(item.file)) failures.push(`unsafe filename ${item.id}`)
    const file = path.join(root, 'apps/web/public', item.file)
    const buffer = await fs.readFile(file)
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex')
    const meta = await sharp(buffer).metadata()
    if (actualHash !== item.sha256 || !item.file.includes(actualHash.slice(0, 12))) failures.push(`hash mismatch ${item.id}`)
    if (buffer.length !== item.bytes || buffer.length === 0) failures.push(`size mismatch ${item.id}`)
    if (meta.width !== item.width || meta.height !== item.height || meta.hasAlpha !== item.alpha) failures.push(`metadata mismatch ${item.id}`)
    if (asset.type === 'character' && !meta.hasAlpha) failures.push(`missing alpha ${item.id}`)
    if (!item.id.endsWith('_2x') && buffer.length > ({ character: 300000, avatar: 30000, background: 450000 }[asset.type])) failures.push(`primary budget ${item.id}`)
    if (asset.type === 'avatar' && buffer.length > 30000) failures.push(`avatar budget ${item.id}`)
    let alphaBounds = null
    if (asset.type === 'character') {
      const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      let left = info.width, right = -1, top = info.height, bottom = -1, transparentPixels = 0
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const alpha = data[(y * info.width + x) * 4 + 3]
        if (alpha === 0) transparentPixels++
        if (alpha >= 64) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y) }
      }
      if (transparentPixels < info.width * info.height * 0.05) failures.push(`not genuinely transparent ${item.id}`)
      alphaBounds = { left, right, top, bottom, transparentPixels }
    }
    checked.push({ id: item.id, sha256: actualHash, bytes: buffer.length, width: meta.width, height: meta.height, alpha: meta.hasAlpha, alphaBounds })
  }
}
if (manifest.budget.firstSceneBytes > 2500000 || manifest.budget.allVariantBytes > 12000000) failures.push('pack budget exceeded')
await fs.access(path.join(root, 'ASSET_LICENSES.md')).catch(() => failures.push('license record missing'))
const sourceIndex = JSON.parse(await fs.readFile(path.join(root, 'art/manifests/source-index.json'), 'utf8'))
const generations = JSON.parse(await fs.readFile(path.join(root, 'art/manifests/generation-log.json'), 'utf8'))
const minimumSources = suffix === 'v2' ? 21 : 17
if (Object.keys(sourceIndex).length < minimumSources || generations.records.length < minimumSources) failures.push('incomplete source evidence')
for (const record of generations.records) {
  if (!record.prompt || record.prompt.length < 50 || !record.output.sha256 || record.review.humanReviewed !== false) failures.push(`incomplete generation evidence ${record.id}`)
}
const uiPath = path.join(root, 'art/manifests/ui-v1.json')
const ui = JSON.parse(await fs.readFile(uiPath, 'utf8'))
for (const asset of ui.assets) {
  const buffer = await fs.readFile(path.join(root, 'apps/web/public', asset.url))
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== asset.sha256 || buffer.length !== asset.bytes) failures.push(`brand hash/bytes ${asset.id}`)
  if (/<script|<image|https?:\/\/(?!www.w3.org)/i.test(buffer.toString('utf8'))) failures.push(`unsafe brand SVG ${asset.id}`)
}
const report = { date: '2026-10-08', version: manifest.version, tool: `node scripts/art/verify.mjs ${suffix}`, checks: ['19 expected logical IDs', `${checked.length} WebP primary/variant file hashes`, '4 original brand SVG hashes and no external resources', 'dimensions', 'actual transparent alpha', 'per-file and pack budgets', 'review records', 'license evidence', `${generations.records.length} exact generation prompts`, 'frozen published manifest equality'], failures, passed: failures.length === 0, checked, brandAssets: ui.assets.length, brandBytes: ui.assets.reduce((s, a) => s + a.bytes, 0), budget: manifest.budget }
await fs.writeFile(path.join(root, 'art/manifests/verification.json'), JSON.stringify(report, null, 2) + '\n')
await fs.writeFile(path.join(root, `art/manifests/verification-${suffix}.json`), JSON.stringify(report, null, 2) + '\n')
if (failures.length) { console.error(failures); process.exitCode = 1 }
else console.log(JSON.stringify({ passed: true, logicalAssets: manifest.assets.length, runtimeFiles: checked.length, budget: manifest.budget }, null, 2))
