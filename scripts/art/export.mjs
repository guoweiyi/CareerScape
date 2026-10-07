import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '../..')
const out = path.join(root, 'apps/web/public/art')
const assets = []
const hash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex')
const present = async (file) => fs.access(file).then(() => true, () => false)
const sourceIndexPath = path.join(root, 'art/manifests/source-index.json')
const sourceIndex = await present(sourceIndexPath) ? JSON.parse(await fs.readFile(sourceIndexPath, 'utf8')) : {}
const sourcePath = (id) => path.join(root, sourceIndex[id]?.file ?? `art/source/${id}.png`)
await fs.mkdir(out, { recursive: true })

async function writeVariant(id, data, extra) {
  const sha256 = hash(data)
  const file = `/art/${id}.${sha256.slice(0, 12)}.webp`
  const target = path.join(root, 'apps/web/public', file)
  if (await present(target)) {
    if (hash(await fs.readFile(target)) !== sha256) throw new Error(`Immutable asset collision: ${id}`)
  } else await fs.writeFile(target, data)
  const meta = await sharp(data).metadata()
  return { id, version: '1.0.0', file, url: file, format: 'webp', sha256, width: meta.width,
    height: meta.height, bytes: data.length, alpha: meta.hasAlpha, ...extra }
}
const common = { reviewStatus: 'agent-reviewed', reviewedBy: 'Codex visual inspection; no human review claimed',
  rights: { sourceType: 'ai-generated', licenseRecordId: 'asset-ai-2026-10-08', redistributionApproved: true },
  generationTool: 'image_gen.imagegen', model: null, modelDisclosure: 'Tool did not expose model/version or seed',
  generationRecord: 'art/manifests/generation-log.json', layer: 20 }
const names = { lin: '林澄', zhou: '周砚', xu: '许知' }
const expressions = { neutral: '平静', relaxed: '轻松', thinking: '思考', serious: '严肃' }

for (const characterId of Object.keys(names)) {
  for (const expressionId of Object.keys(expressions)) {
    const master = sourcePath(`${characterId}-${expressionId}`)
    if (!await present(master)) continue
    const id = `chr_${characterId}_work_half_${expressionId}`
    const base = { ...common, type: 'character', characterId, outfitId: 'work', poseId: 'half', expressionId,
      anchor: { x: 0.5, y: 1 }, focalPoint: { x: 0.5, y: 0.25 }, faceSafeBox: { x: 0.24, y: 0.04, w: 0.52, h: 0.37 },
      safeArea: { x: 0.05, y: 0, w: 0.9, h: 1 }, fallbackId: `avatar_${characterId}_neutral`,
      alt: `${names[characterId]}的${expressions[expressionId]}表情半身立绘`, sourceHash: hash(await fs.readFile(master)) }
    const primary = await writeVariant(id, await sharp(master).resize(768, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 84, alphaQuality: 95 }).toBuffer(), base)
    const retina = await writeVariant(`${id}_2x`, await sharp(master).resize(1152, 1536, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 84, alphaQuality: 95 }).toBuffer(), {})
    primary.variants = [retina]
    assets.push(primary)
    if (expressionId === 'neutral') {
      const m = await sharp(master).metadata()
      const size = Math.round(m.width * 0.62)
      const crop = { left: Math.round(m.width * 0.2), top: Math.round(m.height * 0.035), width: size, height: size }
      const avatar = await writeVariant(`avatar_${characterId}_neutral`, await sharp(master).extract(crop).resize(128, 128).webp({ quality: 88 }).toBuffer(), { ...common, type: 'avatar', layer: 50, characterId, expressionId,
        sourceAssetId: id, crop, anchor: { x: 0.5, y: 0.5 }, focalPoint: { x: 0.5, y: 0.5 }, safeArea: { x: 0, y: 0, w: 1, h: 1 },
        fallbackId: null, alt: `${names[characterId]}的同源头像`, sourceHash: base.sourceHash })
      avatar.variants = [await writeVariant(`avatar_${characterId}_neutral_2x`, await sharp(master).extract(crop).resize(256, 256).webp({ quality: 86 }).toBuffer(), {})]
      assets.push(avatar)
    }
  }
}
for (const [sceneId, name] of Object.entries({ office: '开放办公室', meeting: '会议角', testing: '测试实验区', terrace: '露台' })) {
  const master = sourcePath(sceneId)
  if (!await present(master)) continue
  const id = `bg_${sceneId}_day_wide`
  const base = { ...common, type: 'background', layer: 0, backgroundId: sceneId,
    anchor: { x: 0.5, y: 0.5 }, focalPoint: { x: 0.55, y: 0.37 },
    safeArea: { x: 0.04, y: 0.7, w: 0.92, h: 0.27 }, characterArea: { x: 0.35, y: 0.1, w: 0.4, h: 0.9 },
    cropArea: { x: 0.2, y: 0, w: 0.6, h: 1 }, fallbackId: 'theme-paper', alt: `栖木工作室的${name}`,
    sourceHash: hash(await fs.readFile(master)) }
  assets.push(await writeVariant(id, await sharp(master).resize(1920, 1080, { fit: 'cover' }).webp({ quality: 81 }).toBuffer(), base))
}
let manifest = { schemaVersion: '1.0', id: 'careerscape-art', version: 'careerscape-art-v1', semanticVersion: '1.0.0',
  status: 'draft', createdDate: '2026-10-08', assets,
  budget: { primaryBytes: assets.reduce((sum, item) => sum + item.bytes, 0), allVariantBytes: assets.reduce((sum, item) => sum + item.bytes + (item.variants ?? []).reduce((n, v) => n + v.bytes, 0), 0),
    firstSceneBytes: assets.filter(a => ['chr_lin_work_half_neutral', 'bg_office_day_wide', 'avatar_lin_neutral', 'avatar_zhou_neutral', 'avatar_xu_neutral'].includes(a.id)).reduce((n, a) => n + a.bytes, 0),
    maxPrimaryBytes: Math.max(0, ...assets.map(a => a.bytes)), targetFirstSceneBytes: 2500000, targetPackBytes: 12000000 } }
const previous = await fs.readFile(path.join(root, 'art/manifests/careerscape-v1.json'), 'utf8').then(JSON.parse, () => null)
if (previous?.status === 'published') {
  if (JSON.stringify(previous.assets) !== JSON.stringify(manifest.assets) || JSON.stringify(previous.budget) !== JSON.stringify(manifest.budget)) throw new Error('Published v1 is immutable; create a new asset manifest version before changing files or metadata')
  manifest = previous
}
await fs.writeFile(path.join(root, 'art/manifests/careerscape-v1.json'), JSON.stringify(manifest, null, 2) + '\n')
await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ count: assets.length, budget: manifest.budget, assets: assets.map(a => ({ id: a.id, url: a.url })) }, null, 2))
