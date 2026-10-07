import type { ArtAsset } from '~/types/game'

/** Optional next-scene hint: at most two files / 400KB per turn and 2MB per mounted session. */
export function useScenePrefetch() {
  const preferences = usePreferences(usePinia())
  const manifests = new Map<string, ArtAsset[]>()
  const attempted = new Set<string>()
  let usedBytes = 0
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const disabled = () =>
    stopped ||
    preferences.lowData ||
    preferences.textOnly ||
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData

  async function run(version: string, ids: string[]) {
    if (disabled() || !/^[a-z0-9-]+$/i.test(version) || document.visibilityState !== 'visible') return
    try {
      if (!manifests.has(version)) {
        const manifest = await $fetch<{ assets: ArtAsset[] }>(`/art/manifest-${version}.json`)
        manifests.set(version, manifest.assets)
      }
      let turnBytes = 0
      for (const id of ids.slice(0, 2)) {
        if (disabled()) return
        const asset = manifests.get(version)?.find((candidate) => candidate.id === id)
        const file =
          matchMedia('(max-width:700px)').matches && asset?.variants?.mobile ? asset.variants.mobile : asset
        if (
          !file?.bytes ||
          !/^\/art\/[a-z0-9_]+\.[a-f0-9]{12}\.webp$/.test(file.url) ||
          attempted.has(file.url)
        )
          continue
        if (turnBytes + file.bytes > 400_000 || usedBytes + file.bytes > 2_000_000) continue
        attempted.add(file.url)
        turnBytes += file.bytes
        usedBytes += file.bytes
        const image = new Image()
        image.decoding = 'async'
        image.fetchPriority = 'low'
        image.src = file.url
      }
    } catch {
      /* Optional hints never block a scene or retry failed assets. */
    }
  }
  function schedule(version: string, ids: string[]) {
    clearTimeout(timer)
    timer = setTimeout(() => {
      void run(version, ids)
    }, 800)
  }
  onBeforeUnmount(() => {
    stopped = true
    clearTimeout(timer)
  })
  return { schedule }
}
