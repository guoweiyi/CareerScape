<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { people, type Message } from '~/types/game'
import { dialogueReadingDelay, latestCommittedDialogue, type ReadingSpeed } from '~/utils/committedDialogue'

const props = withDefaults(
  defineProps<{ messages: readonly Message[]; turnKey: string; reducedMotion?: boolean; active?: boolean }>(),
  { reducedMotion: false, active: true },
)
const messages = computed(() => latestCommittedDialogue(props.messages))
const index = ref(0)
const current = computed(() => messages.value[index.value])
const person = computed(() => people[current.value?.speakerId ?? 'narrator'])
const playing = ref(false)
const finished = ref(false)
const speed = ref<ReadingSpeed>('standard')
const status = ref('手动阅读。准备好后，再看下一段。')
const manualAnnouncement = ref('')
const systemReducedMotion = ref(false)
const reduceMotion = computed(() => props.reducedMotion || systemReducedMotion.value)
const delay = computed(() => dialogueReadingDelay(current.value?.text || '', speed.value))
const speedId = `dialogue-speed-${useId()}`
const scope = computed(() =>
  JSON.stringify([
    props.turnKey,
    messages.value.map(({ id, eventSeq, speakerId, text, channel }) => ({
      id,
      eventSeq,
      speakerId,
      text,
      channel,
    })),
  ]),
)
let timer: ReturnType<typeof setTimeout> | undefined
let media: MediaQueryList | undefined
let disposed = false

function clearTimer() {
  if (timer !== undefined) clearTimeout(timer)
  timer = undefined
}
function pause(message = '已暂停。可以继续手动阅读，或再次开启自动播放。') {
  clearTimer()
  playing.value = false
  status.value = message
}
function schedule() {
  clearTimer()
  if (!playing.value || !props.active || !current.value || disposed) return
  const scheduledScope = scope.value
  timer = setTimeout(() => {
    timer = undefined
    if (disposed || !playing.value || !props.active || scheduledScope !== scope.value) return
    if (document.hidden) {
      pause('页面暂时隐藏，自动播放已暂停。返回后可手动继续。')
      return
    }
    if (index.value >= messages.value.length - 1) {
      finished.value = true
      pause('本回合对白已读完，自动播放已停止。可以关闭面板，按自己的节奏继续体验。')
      return
    }
    index.value++
    schedule()
  }, delay.value)
}
function start() {
  if (disposed || !props.active || !current.value || document.hidden) return
  if (finished.value) index.value = 0
  finished.value = false
  manualAnnouncement.value = ''
  playing.value = true
  status.value = '正在按阅读时间自动翻段。随时可以暂停。'
  schedule()
}
function move(offset: -1 | 1) {
  const next = index.value + offset
  if (next < 0 || next >= messages.value.length) return
  pause('正在手动阅读；自动播放保持暂停。')
  finished.value = false
  index.value = next
  const message = current.value
  if (message)
    manualAnnouncement.value = `第 ${next + 1} 段，共 ${messages.value.length} 段。${people[message.speakerId].name}：${message.text}`
}
function visibilityChanged() {
  if (document.hidden && playing.value) pause('页面暂时隐藏，自动播放已暂停。返回后可手动继续。')
}
function motionChanged() {
  systemReducedMotion.value = media?.matches ?? false
}
watch(
  scope,
  () => {
    pause('当前回合已更新，阅读从第一段开始；自动播放保持关闭。')
    index.value = 0
    finished.value = false
    manualAnnouncement.value = ''
  },
  { flush: 'sync' },
)
watch(
  () => props.active,
  (active) => {
    if (!active) pause()
  },
  { flush: 'sync' },
)
watch(
  reduceMotion,
  (reduced) => {
    if (reduced && playing.value) pause('已启用减少动态；自动播放已暂停，可由你明确开启无动画阅读计时。')
  },
  { flush: 'sync' },
)
watch(speed, () => {
  if (playing.value) schedule()
})
onMounted(() => {
  media = window.matchMedia('(prefers-reduced-motion: reduce)')
  motionChanged()
  media.addEventListener('change', motionChanged)
  document.addEventListener('visibilitychange', visibilityChanged)
})
onBeforeUnmount(() => {
  disposed = true
  clearTimer()
  playing.value = false
  document.removeEventListener('visibilitychange', visibilityChanged)
  media?.removeEventListener('change', motionChanged)
})
</script>

<template>
  <section class="committed-dialogue" data-testid="committed-dialogue" :data-playing="playing">
    <p class="reader-intro">
      逐段回看当前回合已保存的人物对白与旁白。翻段只改变阅读位置，不执行行动或推进故事。
    </p>
    <p v-if="reduceMotion" class="reader-motion" data-testid="reader-reduced-motion">
      已采用减少动态偏好。默认手动；如需自动翻段，可明确开启阅读计时，整个过程没有动画。
    </p>
    <template v-if="current">
      <div class="reader-progress" aria-live="off">
        <span data-testid="reader-progress">第 {{ index + 1 }} / {{ messages.length }} 段</span>
        <span>{{ index === messages.length - 1 ? '最后一段' : '已保存的对白' }}</span>
      </div>
      <article
        class="reader-message"
        aria-live="off"
        data-testid="reader-message"
        :data-message-id="current.id"
      >
        <header>
          <strong data-testid="reader-speaker">{{ person.name }}</strong>
          <span>{{ person.role }}</span>
        </header>
        <p class="reader-channel">
          {{
            current.channel === 'private'
              ? '私聊 · 仅你与这位同事'
              : current.channel === 'explanation'
                ? '材料卡 · 仅你可见'
                : '工作群与场景'
          }}
        </p>
        <p class="reader-text" data-testid="reader-text">{{ current.text }}</p>
      </article>
      <div class="reader-navigation" aria-label="手动翻段">
        <button
          type="button"
          class="secondary-button"
          :disabled="index === 0"
          data-testid="reader-previous"
          @click="move(-1)"
        >
          上一段
        </button>
        <button
          type="button"
          class="secondary-button"
          :disabled="index === messages.length - 1"
          data-testid="reader-next"
          @click="move(1)"
        >
          下一段
        </button>
      </div>
      <div class="reader-playback">
        <div class="reader-speed">
          <label :for="speedId">阅读速度</label>
          <select :id="speedId" v-model="speed" data-testid="reader-speed">
            <option value="relaxed">从容</option>
            <option value="standard">适中</option>
            <option value="brisk">较快</option>
          </select>
        </div>
        <button
          type="button"
          class="primary-button"
          :disabled="!active"
          :aria-pressed="playing"
          data-testid="reader-autoplay"
          @click="playing ? pause() : start()"
        >
          {{ playing ? '暂停' : finished ? '从头自动播放' : '自动播放' }}
        </button>
      </div>
      <p class="reader-timing">
        按字数停留 3–12 秒；本段约 {{ (delay / 1000).toFixed(1) }} 秒。长段可暂停慢慢读。
      </p>
      <p class="reader-status" aria-live="off" data-testid="reader-status">{{ status }}</p>
      <p class="reader-help">读完即停止。关闭面板、切换回合或离开当前页面，也会停止计时。</p>
    </template>
    <p v-else class="reader-empty" data-testid="reader-empty">当前回合还没有可逐段阅读的已提交对白。</p>
    <p class="reader-announcement" aria-live="polite" aria-atomic="true" data-testid="reader-announcement">
      {{ manualAnnouncement }}
    </p>
  </section>
</template>

<style scoped>
.committed-dialogue {
  min-width: 0;
  color: #20332d;
}
.reader-intro,
.reader-help,
.reader-timing {
  color: #5c6962;
  line-height: 1.75;
  font-size: 13px;
}
.reader-intro {
  margin: 0 0 20px;
}
.reader-motion {
  padding: 12px 14px;
  border-radius: 10px;
  background: #edf2e8;
  font-size: 13px;
  line-height: 1.75;
}
.reader-progress {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: #5c6962;
  margin: 20px 0 12px;
}
.reader-progress span:first-child {
  color: #285b4b;
  font-weight: 650;
}
.reader-message {
  padding: 22px;
  border: 1px solid #d6ded3;
  border-radius: 16px;
  background: #fffefa;
}
.reader-message header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
}
.reader-message header strong {
  font-size: 19px;
}
.reader-message header span,
.reader-channel {
  color: #5c6962;
  font-size: 12px;
}
.reader-channel {
  margin: 8px 0 20px;
}
.reader-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 17px;
  line-height: 1.95;
}
.reader-navigation {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 18px 0 26px;
}
.reader-navigation button {
  flex: 1;
}
.reader-playback {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  padding-top: 20px;
  border-top: 1px solid #d6ded3;
}
.reader-speed {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reader-speed label {
  font-size: 13px;
}
.reader-speed select {
  min-height: 44px;
  border: 1px solid #bcccb9;
  border-radius: 10px;
  padding: 8px 32px 8px 12px;
  color: #20332d;
  background: #fffefa;
}
.reader-timing {
  font-size: 12px;
  margin: 14px 0;
}
.reader-status {
  background: #edf2e8;
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.75;
}
.reader-help {
  margin: 14px 0 0;
  font-size: 12px;
}
.reader-empty {
  padding: 24px 16px;
  border: 1px dashed #bacbb7;
  border-radius: 12px;
  color: #5c6962;
  line-height: 1.75;
}
.reader-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  padding: 0;
  margin: -1px;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.committed-dialogue :is(button, select):focus-visible {
  outline: 3px solid #a64732;
  outline-offset: 3px;
}
@media (max-width: 420px) {
  .reader-message {
    padding: 18px;
  }
  .reader-playback > button {
    flex: 1;
  }
}
</style>
