<script setup lang="ts">
const props = defineProps<{ assetId: string; alt: string; eager?: boolean }>()
const version = inject<string | Ref<string>>('artManifestVersion', 'current')
const { assets } = useArt(unref(version))
const asset = computed(() => assets.value.find((a) => a.id === props.assetId))
const preferences = usePreferences(usePinia())
const failed = ref(false)
const avatarFailed = ref(false)
const fallbackAvatar = computed(() => {
  const person = /^chr_(lin|zhou|xu)_/.exec(props.assetId)?.[1]
  return person ? assets.value.find((a) => a.id === `avatar_${person}_neutral`) : undefined
})
const displayAsset = computed(() =>
  preferences.lowData
    ? props.assetId.startsWith('bg_')
      ? undefined
      : fallbackAvatar.value || asset.value
    : asset.value,
)
watch(
  () => displayAsset.value?.url,
  () => {
    failed.value = false
    avatarFailed.value = false
  },
)
</script>
<template>
  <picture class="art-picture"
    ><source
      v-if="displayAsset?.variants?.mobile?.url && !failed"
      media="(max-width: 700px)"
      :srcset="displayAsset.variants.mobile.url" />
    <img
      v-if="displayAsset && !failed"
      :src="displayAsset.url"
      :class="{ 'avatar-fallback': preferences.lowData && !!fallbackAvatar }"
      :alt="alt"
      :loading="eager ? 'eager' : 'lazy'"
      :fetchpriority="eager ? 'high' : 'auto'"
      decoding="async"
      @error="failed = true" /><img
      v-else-if="failed && fallbackAvatar && displayAsset?.url !== fallbackAvatar.url && !avatarFailed"
      :src="fallbackAvatar.url"
      :alt="alt"
      class="avatar-fallback"
      decoding="async"
      @error="avatarFailed = true" /><span v-else class="art-fallback" role="img" :aria-label="alt"
      ><slot /></span
  ></picture>
</template>
