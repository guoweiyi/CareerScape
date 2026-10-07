import type { ArtAsset } from '~/types/game'
export function useArt(version = 'current') {
  const safeVersion = /^[a-zA-Z0-9-]+$/.test(version) ? version : 'current'
  const assets = useState<ArtAsset[]>(`art-assets-${safeVersion}`, () => [])
  const attempted = useState(`art-attempted-${safeVersion}`, () => false)
  async function load() {
    if (attempted.value) return
    attempted.value = true
    try {
      const manifest = await $fetch<{ assets: ArtAsset[] }>(
        safeVersion === 'current' ? '/art/manifest.json' : `/art/manifest-${safeVersion}.json`,
      )
      assets.value = manifest.assets
    } catch {
      assets.value = []
    }
  }
  const url = (id: string) => assets.value.find((asset) => asset.id === id)?.url
  onMounted(load)
  return { assets, url, load }
}
