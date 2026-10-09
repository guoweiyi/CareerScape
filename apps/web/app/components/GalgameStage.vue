<script setup lang="ts">
import type { GalgameSessionDTO } from '../../../../packages/contracts/galgame'
const props = defineProps<{ session: GalgameSessionDTO; busy: boolean }>()
const emit = defineEmits<{ 'read-complete': [value: boolean] }>()
const preferences = usePreferences(usePinia()),
  prefetch = useScenePrefetch()
const cursor = ref(0),
  revealed = ref(0),
  automatic = ref(false),
  hidden = ref(false)
let typeTimer: ReturnType<typeof setTimeout> | undefined, autoTimer: ReturnType<typeof setTimeout> | undefined
const lines = computed(() =>
  props.session.messages.filter(
    (message) => message.eventSeq === props.session.eventSeq && message.speakerId !== 'player',
  ),
)
const line = computed(() => lines.value[cursor.value])
const characters = computed(() =>
  line.value?.channel === 'private'
    ? props.session.characters.filter((person) => person.id === line.value?.recipientId)
    : props.session.characters,
)
const letters = computed(() => Array.from(line.value?.text || ''))
const revealing = computed(() => revealed.value < letters.value.length)
const text = computed(() => letters.value.slice(0, revealed.value).join(''))
const speaker = computed(
  () => props.session.characters.find((person) => person.id === line.value?.speakerId)?.name || '此刻',
)
const complete = computed(() => !revealing.value && cursor.value >= lines.value.length - 1)
function stopTimers() {
  clearTimeout(typeTimer)
  clearTimeout(autoTimer)
}
function schedule() {
  stopTimers()
  if (hidden.value || props.busy) return
  if (preferences.reducedMotion || preferences.galgameInstantText) revealed.value = letters.value.length
  if (revealing.value)
    typeTimer = setTimeout(() => {
      revealed.value++
      schedule()
    }, preferences.galgameTextSpeed)
  else if (automatic.value && !complete.value)
    autoTimer = setTimeout(() => {
      cursor.value++
      revealed.value = 0
      schedule()
    }, preferences.galgameAutoDelay * 1000)
}
function next() {
  if (revealing.value) {
    revealed.value = letters.value.length
    schedule()
  } else if (!complete.value) {
    cursor.value++
    revealed.value = 0
    schedule()
  }
}
function showAll() {
  revealed.value = letters.value.length
  schedule()
}
function visibility() {
  hidden.value = document.hidden
  if (hidden.value) automatic.value = false
  schedule()
}
watch(
  () => [props.session.branchId, props.session.revision],
  () => {
    cursor.value = 0
    revealed.value = 0
    automatic.value = false
    schedule()
  },
  { immediate: true },
)
watch(
  () => [
    props.busy,
    preferences.galgameInstantText,
    preferences.galgameTextSpeed,
    preferences.galgameAutoDelay,
    preferences.reducedMotion,
    automatic.value,
  ],
  schedule,
)
watch(complete, (value) => emit('read-complete', value), { immediate: true })
watch(line, (value) => {
  if (value && value.speakerId !== 'narrator' && value.speakerId !== 'player')
    prefetch.schedule(props.session.assetManifestVersion, [
      `chr_${value.speakerId}_work_half_${value.expression}`,
    ])
})
onMounted(() => {
  document.addEventListener('visibilitychange', visibility)
  visibility()
})
onBeforeUnmount(() => {
  stopTimers()
  document.removeEventListener('visibilitychange', visibility)
})
</script>
<template>
  <section
    class="gal-stage"
    :class="{ 'gal-stage-text': preferences.textOnly, 'gal-stage-reduced': preferences.reducedMotion }"
    aria-label="职业故事舞台"
  >
    <ArtImage
      v-if="!preferences.textOnly"
      class="gal-stage-background"
      :asset-id="`bg_${session.scene?.background || 'office'}_day_wide`"
      alt="当前虚构工作场景"
      eager
    />
    <div class="gal-stage-wash" />
    <div class="gal-scene-heading">
      <span class="status-dot" /><span>{{ session.scene?.title || '你的工位，正在准备中' }}</span
      ><small>模拟工作 · {{ session.minutes }} 分钟</small>
    </div>
    <div
      v-if="!preferences.textOnly"
      class="gal-figures"
      :class="{ 'gal-private-figure': line?.channel === 'private' }"
    >
      <div
        v-for="person in characters"
        :key="person.id"
        class="gal-figure"
        :class="{ speaking: line?.speakerId === person.id }"
      >
        <ArtImage
          :asset-id="`chr_${person.id}_work_half_${line?.speakerId === person.id ? line.expression : person.expression}`"
          :alt="`${person.name}，${person.role}`"
          eager
        />
        <span
          >{{ person.name }}<small>{{ person.role }}</small></span
        >
      </div>
    </div>
    <div
      class="gal-dialogue"
      tabindex="0"
      @keydown.space.self.prevent="next"
      @keydown.enter.self.prevent="next"
    >
      <div class="gal-dialogue-top">
        <span class="gal-speaker">{{ speaker }}</span
        ><span v-if="line?.channel === 'private'" class="gal-private-label">只与你的私聊</span
        ><small>{{ lines.length ? `${cursor + 1} / ${lines.length}` : '已保存' }}</small>
      </div>
      <p class="gal-dialogue-text" :aria-label="line?.text">
        {{
          text ||
          (session.status === 'ended'
            ? '这段工作已经保存。可以回看、复盘，或让另一种选择继续。'
            : '故事会从你的第一项工作开始。')
        }}<span v-if="revealing" class="gal-caret" aria-hidden="true">▍</span>
      </p>
      <div class="gal-reader-controls">
        <label
          ><input
            v-model="automatic"
            type="checkbox"
            :disabled="busy || hidden || complete"
          />自动读对白</label
        >
        <span v-if="complete" class="gal-read-done">这一段已读完</span>
        <button v-else-if="revealing" class="text-link" :disabled="busy" @click="showAll">显示整句</button>
        <button v-else class="secondary-button" :disabled="busy" @click="next">
          下一句 <span aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  </section>
</template>
