import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const root = path.resolve(import.meta.dirname, '../..')
const dir = path.join(root, 'art/source')
const index = {}
const logPath = path.join(root, 'art/manifests/generation-log.json')
const log = JSON.parse(await fs.readFile(logPath, 'utf8'))
for (const entry of log.records) {
  const candidates = (await fs.readdir(dir)).filter(name => name === `${entry.id}.png` || name.startsWith(`${entry.id}.`) && name.endsWith('.png'))
  if (candidates.length !== 1) throw new Error(`Expected one master for ${entry.id}`)
  const file = path.join(dir, candidates[0])
  const data = await fs.readFile(file)
  const sha256 = crypto.createHash('sha256').update(data).digest('hex')
  const name = `${entry.id}.${sha256.slice(0, 12)}.png`
  const target = path.join(dir, name)
  if (!target.startsWith(`${dir}${path.sep}`)) throw new Error('Source path escaped workspace')
  if (file !== target) await fs.rename(file, target)
  const metadata = await sharp(data).metadata()
  index[entry.id] = { file: `art/source/${name}`, sha256, bytes: data.length, width: metadata.width, height: metadata.height, alpha: metadata.hasAlpha }
  entry.output = index[entry.id]
}
await fs.writeFile(path.join(root, 'art/manifests/source-index.json'), JSON.stringify(index, null, 2) + '\n')
await fs.writeFile(logPath, JSON.stringify(log, null, 2) + '\n')
console.log(`Frozen ${Object.keys(index).length} actual PNG masters with SHA-256 filenames.`)
