<script setup lang="ts">
import type { GalgameAction, GalgameMessage, GalgameSessionDTO } from '../../../../packages/contracts/galgame'
type Input = Omit<GalgameAction, 'clientActionId' | 'branchId' | 'expectedRevision' | 'channel'> & {
  channel?: 'group' | 'private'
}
const props = defineProps<{ session: GalgameSessionDTO; disabled: boolean; canAct: boolean }>()
const emit = defineEmits<{ action: [input: Input]; fork: [eventSeq: number] }>()
const { identity, mutate } = useIdentity(),
  drafts = useDrafts(),
  preferences = usePreferences(usePinia())
const tab = ref('task'),
  fields = reactive<Record<string, string>>({}),
  journal = ref(''),
  notice = ref(''),
  error = ref(''),
  journalBusy = ref(false)
const history = ref<GalgameMessage[]>([]),
  historyMore = ref(false),
  historyBefore = ref<number | null>(null),
  historyBusy = ref(false)
let draftTimer: ReturnType<typeof setTimeout> | undefined,
  currentBranch = ''
const tabs = computed(() => [
  { id: 'task', label: '工作台' },
  { id: 'materials', label: '资料' },
  { id: 'people', label: '同事' },
  { id: 'history', label: '记录' },
  { id: 'journal', label: '手账' },
  ...(props.session.status === 'ended' ? [{ id: 'review', label: '就业复盘' }] : []),
  { id: 'settings', label: '设置' },
])
const draftKey = () =>
  `galgame:${identity.value.user?.id}:${props.session.id}:${props.session.branchId}:workbench`
const canSubmit = computed(
  () =>
    props.canAct &&
    props.session.status === 'active' &&
    props.session.artifactFields.every((field) => (fields[field.id] || '').trim().length >= 8),
)
const historyGroups = computed(() =>
  [...new Set(history.value.map((message) => message.eventSeq))]
    .sort((a, b) => a - b)
    .map((eventSeq) => ({
      eventSeq,
      messages: history.value.filter((message) => message.eventSeq === eventSeq),
    })),
)
const sourceFor = (id: string) => props.session.sources.find((source) => source.id === id)
const mentor = computed(() =>
  props.session.characters.find(
    (person) =>
      person.id === ({ qa: 'lin', frontend: 'zhou', product: 'xu' } as const)[props.session.careerId],
  ),
)
function name(id: string) {
  return id === 'player'
    ? props.session.player.name
    : id === 'narrator'
      ? '此刻'
      : props.session.characters.find((person) => person.id === id)?.name || '同事'
}
function submitArtifact() {
  if (canSubmit.value)
    emit('action', {
      kind: 'submit_artifact',
      artifact: { id: crypto.randomUUID(), taskId: props.session.tasks[0]!.id, fields: { ...fields } },
    })
}
async function loadHistory() {
  if (historyBusy.value || !historyMore.value) return
  historyBusy.value = true
  error.value = ''
  const branchId = props.session.branchId
  try {
    const page = await $fetch<{
      messages: GalgameMessage[]
      hasMore: boolean
      nextBeforeEventSeq: number | null
    }>(`/api/sessions/${props.session.id}/history`, {
      query: { branchId, beforeEventSeq: historyBefore.value || props.session.eventSeq + 1 },
    })
    if (branchId !== props.session.branchId) return
    history.value = [
      ...new Map([...page.messages, ...history.value].map((message) => [message.id, message])).values(),
    ]
    historyMore.value = page.hasMore
    historyBefore.value = page.nextBeforeEventSeq
  } catch {
    error.value = '较早的记录暂时无法读取，请稍后重试。'
  } finally {
    historyBusy.value = false
  }
}
async function openEvidence(eventSeq: number) {
  tab.value = 'history'
  if (historyBusy.value) return
  while (historyMore.value && !history.value.some((message) => message.eventSeq === eventSeq)) {
    await loadHistory()
    if (error.value) break
  }
  await nextTick()
  document
    .getElementById(`gal-event-${eventSeq}`)
    ?.scrollIntoView({ block: 'nearest', behavior: preferences.reducedMotion ? 'instant' : 'smooth' })
}
async function saveJournal() {
  journalBusy.value = true
  error.value = ''
  notice.value = ''
  const branchId = props.session.branchId
  try {
    await mutate(`/api/sessions/${props.session.id}/journal`, { branchId, text: journal.value })
    if (branchId === props.session.branchId) notice.value = '手账已保存，仅你可见，不会发送给故事角色。'
  } catch {
    error.value = '手账暂未保存，请保留文字后重试。'
  } finally {
    journalBusy.value = false
  }
}
watch(
  () => [props.session.branchId, props.session.revision],
  async () => {
    const changedBranch = currentBranch !== props.session.branchId
    if (currentBranch !== props.session.branchId) {
      clearTimeout(draftTimer)
      currentBranch = props.session.branchId
      Object.keys(fields).forEach((key) => Reflect.deleteProperty(fields, key))
      props.session.artifactFields.forEach((field) => (fields[field.id] = ''))
      history.value = []
      journal.value = ''
      notice.value = ''
      error.value = ''
      const branchId = currentBranch,
        userId = identity.value.user?.id
      try {
        const [saved, diary] = await Promise.all([
          drafts.get<{ fields: Record<string, string>; journal: string }>(draftKey()).catch(() => undefined),
          $fetch<{ text: string }>(`/api/sessions/${props.session.id}/journal`, { query: { branchId } }),
        ])
        if (branchId !== props.session.branchId || userId !== identity.value.user?.id) return
        for (const field of props.session.artifactFields)
          if (typeof saved?.fields[field.id] === 'string')
            fields[field.id] = saved.fields[field.id]!.slice(0, 2000)
        journal.value = saved?.journal ?? diary.text
      } catch {
        /* An optional draft cannot prevent playing the saved story. */
      }
    }
    history.value = [
      ...new Map(
        [...history.value, ...props.session.messages].map((message) => [message.id, message]),
      ).values(),
    ]
    if (changedBranch) historyMore.value = props.session.hasMoreHistory
    historyBefore.value = history.value.length
      ? Math.min(...history.value.map((message) => message.eventSeq))
      : null
  },
  { immediate: true },
)
watch(
  [fields, journal],
  () => {
    clearTimeout(draftTimer)
    const key = draftKey(),
      value = { fields: { ...fields }, journal: journal.value }
    draftTimer = setTimeout(() => {
      void drafts.put(key, value).catch(() => undefined)
    }, 500)
  },
  { deep: true },
)
onBeforeUnmount(() => clearTimeout(draftTimer))
</script>
<template>
  <aside class="gal-workbench" aria-label="工作资料与记录">
    <nav class="gal-tool-tabs" aria-label="工作台页面">
      <button
        v-for="item in tabs"
        :key="item.id"
        :class="{ selected: tab === item.id }"
        :aria-pressed="tab === item.id"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </nav>
    <div class="gal-tool-content">
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <template v-if="tab === 'task'">
        <p class="eyebrow">YOUR WORK, YOUR EVIDENCE</p>
        <h2>{{ session.tasks[0]?.title }}</h2>
        <p class="muted">{{ session.taskBrief }}</p>
        <p class="gal-task-status">
          {{
            {
              open: '先了解任务与材料',
              working: '正在整理工作依据',
              review: '产物已提交，等待或完善复核',
              done: '产物已通过 AI 模拟审阅',
            }[session.tasks[0]!.status]
          }}
        </p>
        <p class="muted">由{{ mentor?.name }}陪你复核。先提问、收集材料，再把你的判断落到一份具体产物上。</p>
        <form class="gal-artifact-form" @submit.prevent="submitArtifact">
          <label v-for="field in session.artifactFields" :key="field.id" class="gal-field"
            >{{ field.label
            }}<textarea
              v-model="fields[field.id]"
              :aria-label="field.label"
              rows="3"
              minlength="8"
              maxlength="2000"
              :placeholder="field.hint"
              :disabled="disabled || session.status !== 'active'"
              required
            /><small>{{ field.hint }}</small></label
          >
          <button class="primary-button" :disabled="disabled || !canSubmit">提交给导师审阅 ↗</button
          ><small class="muted">每项至少8个字；审阅依据本局材料，代码片段仅作审阅。</small>
        </form>
        <article
          v-for="(artifact, index) in session.artifacts.slice().reverse()"
          :key="artifact.id"
          class="gal-artifact-record"
        >
          <h3>已保存的产物 {{ session.artifacts.length - index }}</h3>
          <p v-if="artifact.review">
            {{ artifact.review.decision === 'accepted' ? 'AI 模拟审阅通过' : '需要补充或调整' }} ·
            {{ artifact.review.feedback }}
          </p>
          <p v-else>已保存，仍需复核。</p>
          <details>
            <summary>回看提交内容</summary>
            <dl>
              <template v-for="field in session.artifactFields" :key="field.id"
                ><dt>{{ field.label }}</dt>
                <dd>{{ artifact.fields[field.id] }}</dd></template
              >
            </dl>
          </details>
        </article>
      </template>
      <template v-else-if="tab === 'materials'">
        <p class="eyebrow">KNOW WHAT YOU KNOW</p>
        <h2>手边的材料</h2>
        <p class="muted">这些是你已经获得的虚构案例材料。需要协作时，可以明确分享给团队。</p>
        <article v-for="fact in session.facts" :key="fact.id" class="gal-fact-card">
          <p>{{ fact.text }}</p>
          <button
            class="text-link"
            :disabled="disabled || !canAct || session.status !== 'active'"
            @click="
              emit('action', {
                kind: 'act',
                text: '向团队分享这条已经获得的材料，讨论下一步。',
                shareFactIds: [fact.id],
              })
            "
          >
            向团队分享 ↗
          </button>
        </article>
        <h3>岗位流程依据</h3>
        <article v-for="source in session.sources" :key="source.id" class="gal-source-card">
          <a :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.title }} ↗</a
          ><small>{{ source.publisher }} · 核验 {{ source.consultedAt }}</small>
          <p>{{ source.summary }}</p>
          <small>{{ source.scope }}</small>
        </article>
        <h3>这份工作的边界</h3>
        <ul>
          <li v-for="item in session.authority" :key="item">{{ item }}</li>
        </ul>
      </template>
      <template v-else-if="tab === 'people'">
        <p class="eyebrow">PEOPLE YOU WORK WITH</p>
        <h2>今天的同事</h2>
        <article v-for="person in session.characters" :key="person.id" class="gal-person-card">
          <ArtImage :asset-id="`avatar_${person.id}_neutral`" :alt="person.name" />
          <div>
            <h3>{{ person.name }}</h3>
            <p>{{ person.role }}{{ person.id === mentor?.id ? ' · 本局导师' : '' }}</p>
          </div>
        </article>
        <p class="muted">同事会记住实际收到的消息。私聊内容由你决定是否向团队分享。</p>
      </template>
      <template v-else-if="tab === 'history'">
        <p class="eyebrow">WHAT ACTUALLY HAPPENED</p>
        <h2>走过的片段</h2>
        <button v-if="historyMore" class="secondary-button" :disabled="historyBusy" @click="loadHistory">
          {{ historyBusy ? '正在读取…' : '读取更早的片段' }}
        </button>
        <article
          v-for="group in historyGroups"
          :id="`gal-event-${group.eventSeq}`"
          :key="group.eventSeq"
          class="gal-history-event"
        >
          <div v-for="message in group.messages" :key="message.id">
            <strong
              >{{ name(message.speakerId)
              }}<small v-if="message.channel === 'private'">
                · 与{{ name(message.recipientId || '') }}的私聊</small
              ><small v-else-if="message.channel === 'explanation'"> · 职业说明</small></strong
            >
            <p>{{ message.text }}</p>
          </div>
          <button class="text-link" :disabled="disabled" @click="emit('fork', group.eventSeq)">
            从这一段尝试另一种选择 ↗
          </button>
        </article>
        <button class="secondary-button" :disabled="disabled" @click="emit('fork', 1)">回到开场之前</button>
      </template>
      <template v-else-if="tab === 'journal'">
        <p class="eyebrow">A NOTE TO YOURSELF</p>
        <h2>只留给自己的手账</h2>
        <label class="gal-field"
          >这段工作，让你想到了什么？<textarea
            v-model="journal"
            rows="10"
            maxlength="10000"
            :disabled="journalBusy || disabled"
          /></label
        ><button class="secondary-button" :disabled="journalBusy || disabled" @click="saveJournal">
          {{ journalBusy ? '正在保存…' : '保存手账' }}
        </button>
        <p v-if="notice" class="notice" role="status">{{ notice }}</p>
        <p class="muted">手账仅你可见，不进入 AI 角色的上下文。</p>
      </template>
      <template v-else-if="tab === 'review'">
        <p class="eyebrow">FROM EXPERIENCE TO NEXT STEPS</p>
        <h2>把这段经历，带向下一步</h2>
        <template v-if="session.debrief"
          ><p>{{ session.debrief.summary }}</p>
          <article
            v-for="item in session.debrief.observations"
            :key="item.eventSeq + item.text"
            class="gal-fact-card"
          >
            <p>{{ item.text }}</p>
            <button class="text-link" @click="openEvidence(item.eventSeq)">回看行动依据 ↗</button
            ><a
              v-if="sourceFor(item.sourceId)"
              class="text-link"
              :href="sourceFor(item.sourceId)!.url"
              target="_blank"
              rel="noopener noreferrer"
              >岗位资料 ↗</a
            >
          </article>
          <h3>可以继续练习</h3>
          <ul>
            <li v-for="item in session.debrief.nextSteps" :key="item">{{ item }}</li>
          </ul>
          <h3>面试表达练习</h3>
          <p class="gal-interview">{{ session.debrief.interviewPractice }}</p></template
        >
        <template v-else
          ><p class="muted">AI 会根据本局实际行动和工作产物，整理岗位理解、练习建议及模拟项目表达。</p>
          <button
            class="primary-button"
            :disabled="disabled || !canAct"
            @click="emit('action', { kind: 'debrief' })"
          >
            生成就业复盘 ↗
          </button></template
        >
      </template>
      <template v-else-if="tab === 'settings'">
        <p class="eyebrow">AT YOUR OWN PACE</p>
        <h2>用自己的节奏阅读</h2>
        <label class="gal-setting"
          ><input
            v-model="preferences.galgameInstantText"
            type="checkbox"
            @change="preferences.save()"
          />直接显示整句</label
        >
        <label class="gal-field"
          >逐字速度<select v-model.number="preferences.galgameTextSpeed" @change="preferences.save()">
            <option :value="15">快一些</option>
            <option :value="35">自然节奏</option>
            <option :value="60">慢一些</option>
          </select></label
        >
        <label class="gal-field"
          >自动播放每句停留<select v-model.number="preferences.galgameAutoDelay" @change="preferences.save()">
            <option v-for="seconds in [3, 5, 8, 12]" :key="seconds" :value="seconds">{{ seconds }} 秒</option>
          </select></label
        >
        <label class="gal-setting"
          ><input
            v-model="preferences.textOnly"
            type="checkbox"
            @change="preferences.save()"
          />文字模式</label
        ><label class="gal-setting"
          ><input
            v-model="preferences.lowData"
            type="checkbox"
            @change="preferences.save()"
          />低流量模式</label
        ><label class="gal-setting"
          ><input
            v-model="preferences.reducedMotion"
            type="checkbox"
            @change="preferences.save()"
          />减少动画</label
        >
        <p class="muted">自动播放只读对白，行动始终由你选择。离开页面或切换路线后会暂停。</p>
      </template>
    </div>
  </aside>
</template>
