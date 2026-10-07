import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const root = path.resolve(import.meta.dirname, '../..')
const assets = []
for (const dark of [false, true]) for (const wide of [false, true]) {
  const color = dark ? '#F7F4EE' : '#285B4B'
  const id = `brand_${wide ? 'wordmark' : 'icon'}_${dark ? 'dark' : 'light'}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wide ? 400 : 96}" height="96" viewBox="0 0 ${wide ? 400 : 96} 96" role="img" aria-label="职境漫游 CareerScape"><g fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M24 19h48a9 9 0 0 1 9 9v32a9 9 0 0 1-9 9H48L30 81V69h-6a9 9 0 0 1-9-9V28a9 9 0 0 1 9-9Z"/><path d="M48 60V47m0 0L34 34m14 13 14-13"/><circle cx="34" cy="33" r="3"/><circle cx="62" cy="33" r="3"/></g>${wide ? `<text x="108" y="47" fill="${color}" font-size="28" font-weight="600" font-family="system-ui,Microsoft YaHei,sans-serif">职境漫游</text><text x="109" y="72" fill="${color}" font-size="15" letter-spacing="2" font-family="system-ui,sans-serif">CareerScape</text>` : ''}</svg>`
  const buffer = Buffer.from(svg)
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
  const name = `${id}.${sha256.slice(0, 12)}.svg`
  await fs.writeFile(path.join(root, 'art/ui', name), buffer)
  await fs.writeFile(path.join(root, 'apps/web/public/art', name), buffer)
  assets.push({ id, version: '1.0.0', url: `/art/${name}`, sha256, format: 'svg', bytes: buffer.length, width: wide ? 400 : 96, height: 96, type: 'brand', reviewStatus: 'agent-reviewed', rights: { sourceType: 'original-code', licenseRecordId: 'asset-ui-2026-10-08', redistributionApproved: true }, constraints: { minimumWidth: wide ? 160 : 24, clearSpace: 0.25, externalScripts: false, embeddedImages: false } })
}
await fs.writeFile(path.join(root, 'art/manifests/ui-v1.json'), JSON.stringify({ version: 'careerscape-ui-v1', assets }, null, 2) + '\n')
console.log(assets.map(asset => asset.url).join('\n'))
