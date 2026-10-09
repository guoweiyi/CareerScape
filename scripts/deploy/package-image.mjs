import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

const [sourceImage, sha, output] = process.argv.slice(2)
if (!sourceImage || sourceImage.startsWith('-') || !/^[a-f0-9]{40}$/.test(sha || '') || !output) {
  throw new Error('Usage: node scripts/deploy/package-image.mjs <image> <git-sha> <output>')
}
const directory = resolve(output)
await mkdir(directory, { recursive: true })
const image = JSON.parse(execFileSync('docker', ['image', 'inspect', sourceImage], { encoding: 'utf8' }))[0]
if (image.Config.Labels?.['org.opencontainers.image.revision'] !== sha || image.Architecture !== 'amd64') {
  throw new Error('Image revision/platform does not match the release.')
}
const imageTag = `careerscape:sha-${sha}`
execFileSync('docker', ['tag', sourceImage, imageTag])
const archive = resolve(directory, 'careerscape-image.tar.gz')
const child = spawn('docker', ['save', imageTag], { stdio: ['ignore', 'pipe', 'inherit'] })
const completion = new Promise((accept, reject) => {
  child.on('error', reject)
  child.on('close', code => code === 0 ? accept() : reject(new Error(`docker save failed: ${code}`)))
})
await Promise.all([pipeline(child.stdout, createGzip(), createWriteStream(archive)), completion])
async function hashFile(path) {
  const hash = createHash('sha256')
  for await (const part of createReadStream(path)) hash.update(part)
  return hash.digest('hex')
}
const files = {}
for (const name of ['deploy.sh', 'compose.production.yaml']) {
  await copyFile(resolve('scripts/deploy', name), resolve(directory, name))
  files[name] = createHash('sha256').update(await readFile(resolve(directory, name))).digest('hex')
}
const archiveSha256 = await hashFile(archive)
await writeFile(resolve(directory, 'careerscape-image.sha256'), `${archiveSha256}  careerscape-image.tar.gz\n`)
await writeFile(resolve(directory, 'release.json'), JSON.stringify({
  version: 1, gitSha: sha, imageTag, imageId: image.Id, archiveSha256, files,
}, null, 2) + '\n')
console.log(`Packaged verified image ${imageTag} (${image.Id}).`)
