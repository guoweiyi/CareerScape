import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(await fs.readFile(path.join(root, 'art/manifests/careerscape-v1.json'), 'utf8'))
const sourceIndex = JSON.parse(await fs.readFile(path.join(root, 'art/manifests/source-index.json'), 'utf8'))
manifest.version = 'careerscape-art-v2'
manifest.semanticVersion = '1.1.0'
manifest.schemaVersion = '1.1'
manifest.status = 'draft'
delete manifest.publishedDate
delete manifest.reviewedBy
for (const asset of manifest.assets) {
  if (Array.isArray(asset.variants)) asset.variants = { retina: asset.variants[0] }
  if (asset.type !== 'background') continue
  const source = sourceIndex[`${asset.backgroundId}-mobile`]
  const data = await sharp(path.join(root, source.file)).resize(1080, 1440).webp({ quality: 81 }).toBuffer()
  const sha256 = crypto.createHash('sha256').update(data).digest('hex')
  const id = `bg_${asset.backgroundId}_day_mobile`
  const file = `/art/${id}.${sha256.slice(0, 12)}.webp`
  const output = path.join(root, 'apps/web/public', file)
  const previous = await fs.readFile(output).catch(() => null)
  if (previous && !previous.equals(data)) throw new Error('Immutable file collision')
  if (!previous) await fs.writeFile(output, data)
  asset.variants = { mobile: { id, version: '1.0.0', file, url: file, format: 'webp', sha256,
    width: 1080, height: 1440, bytes: data.length, alpha: false, sourceHash: source.sha256,
    sourceAssetId: asset.id, composition: 'independently-generated-portrait',
    generationRecordId: `${asset.backgroundId}-mobile`, focalPoint: { x: 0.55, y: 0.4 },
    safeArea: { x: 0.04, y: 0.75, w: 0.92, h: 0.22 }, characterArea: { x: 0.35, y: 0.18, w: 0.4, h: 0.52 } } }
}
manifest.budget.allVariantBytes = manifest.assets.reduce((s, a) => s + a.bytes + Object.values(a.variants ?? {}).reduce((n, v) => n + v.bytes, 0), 0)
manifest.budget.mobileBackgroundBytes = manifest.assets.filter(a => a.type === 'background').reduce((s, a) => s + a.variants.mobile.bytes, 0)
const office = manifest.assets.find(a => a.id === 'bg_office_day_wide')
manifest.budget.firstSceneMobileBytes = manifest.budget.firstSceneBytes - office.bytes + office.variants.mobile.bytes
const out = path.join(root, 'art/manifests/careerscape-v2.json')
const previous = await fs.readFile(out, 'utf8').then(JSON.parse, () => null)
if (previous?.status === 'published') {
  if (JSON.stringify(previous.assets) !== JSON.stringify(manifest.assets)) throw new Error('Published v2 is immutable')
} else await fs.writeFile(out, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ version: manifest.version, mobile: manifest.assets.filter(a => a.type === 'background').map(a => a.variants.mobile), budget: manifest.budget }, null, 2))
