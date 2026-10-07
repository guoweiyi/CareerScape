<script setup lang="ts">
import { readJsonlStream, type ActionInput } from '../../../../../packages/contracts'
import { people, type Session, type Message } from '~/types/game'
const route = useRoute()
const sessionId = String(route.params.id)
const { identity, ensure, mutate } = useIdentity()
const preferences = usePreferences(usePinia())
const castIds = ['lin', 'zhou', 'xu'] as const
const preferenceOptions = [['textOnly', '纯文字模式'], ['lowData', '低流量模式'], ['reducedMotion', '减少动态效果'], ['showAllText', '直接显示完整对白']] as const
const drafts = useDrafts()
const prefetch = useScenePrefetch()
const session = shallowRef<Session | null>(null)
const historyPage = ref<Message[] | null>(null)
const historyCursor = ref<number | null>(null)
const hasMoreHistory = ref(false)
provide(
  'artManifestVersion',
  computed(() => session.value?.assetManifestVersion || 'current'),
)
const streamPreview = shallowRef<{ id: string; speakerId: keyof typeof people; text: string }[]>([])
let streamMessages: { id: string; speakerId: keyof typeof people; text: string }[] = []
let raf = 0
const busy = ref(false)
const error = ref('')
const statusText = ref('正在打开存档…')
const input = ref('')
const panel = ref<'history' | 'journal' | 'settings' | 'branches' | null>(null)
let panelTrigger: HTMLElement | null = null
const channel = ref('group')
function openPrivateChat(id: string) { channel.value = id; panel.value = 'history' }
const journal = ref('')
const journalStatus = ref('')
const journalBusy = ref(false)
let journalRequest = 0
const online = ref(true)
const pending = ref<ActionInput | null>(null)
let controller: AbortController | undefined
const messages = computed(() => session.value?.messages ?? [])
const recentMessages = computed(() => {
  const all = messages.value
  if (!all.length) return []
  const seq = all.at(-1)?.eventSeq
  return all.filter((m) => m.eventSeq === seq && m.speakerId !== 'player')
})
const mainMessage = computed(
  () => recentMessages.value.find((m) => m.speakerId !== 'narrator') ?? recentMessages.value[0],
)
const mainPerson = computed(() => people[mainMessage.value?.speakerId ?? 'narrator'])
const character = computed(() => {
  const id = mainMessage.value?.speakerId
  return id && ['lin', 'zhou', 'xu'].includes(id) ? id : null
})
const isEnded = computed(() => session.value?.node.nodeType === 'ending')
const draftKey = computed(() => `${identity.value.user?.id}:${sessionId}`)
const selectedMessages = computed(() =>
  (historyPage.value ?? messages.value)
    .filter((m) =>
      channel.value === 'group'
        ? m.channel !== 'private'
        : m.channel === 'private' && m.recipientId === channel.value,
    )
    .slice(-80),
)
async function load(branchId?: string) {
  session.value = await $fetch<Session>(`/api/sessions/${sessionId}`, {
    query: branchId ? { branchId } : undefined,
  })
  statusText.value = `已保存 · 修订 ${session.value.revision}`
  prefetch.schedule(session.value.assetManifestVersion, session.value.prefetchAssetIds || [])
}
async function boot() {
  try {
    await ensure()
    await load()
    const saved = await drafts.get<{ text: string; pending: ActionInput | null }>(draftKey.value)
    if (saved) {
      input.value = saved.text
      pending.value = saved.pending
      if (saved.pending) await recover()
    }
  } catch (e) {
    error.value = errorText(e)
    statusText.value = '存档尚未同步'
  }
}
function errorText(e: unknown) {
  if (e && typeof e === 'object' && 'data' in e) {
    const data = e.data as { message?: string; statusMessage?: string }
    return data?.message || data?.statusMessage || '请求未完成，请重试'
  }
  return e instanceof Error ? e.message : '请求未完成，请重试'
}
async function confirmIntent() {
  const intent = session.value?.lastIntent
  if (!intent || intent.confidence < 0.9) return
  panel.value = null
  await act(intent.kind === 'leave' ? 'leave' : 'choice', intent.kind === 'help' ? 'help' : intent.choiceId)
}
async function remember() {
  await drafts.put(draftKey.value, { text: input.value, pending: pending.value }).catch(() => undefined)
}
async function recover() {
  if (!pending.value) {
    await load()
    return
  }
  const turn = await $fetch<{ status: string; session?: Session }>(`/api/sessions/${sessionId}/turn`, {
    query: { clientActionId: pending.value.clientActionId },
  }).catch(() => null)
  if (turn?.status === 'committed') {
    await load(pending.value.branchId)
    pending.value = null
    input.value = ''
    await remember()
    error.value = ''
    statusText.value = '已恢复服务器确认的结果'
  } else {
    await load(pending.value.branchId)
    statusText.value = '上次操作待确认，可用相同动作编号重试'
  }
}
async function act(kind: ActionInput['kind'], choiceId?: string, retry = false) {
  if (!session.value || busy.value || (pending.value && !retry)) return
  busy.value = true
  error.value = ''
  statusText.value = '正在确认本次行动…'
  const action: ActionInput =
    retry && pending.value
      ? pending.value
      : {
          clientActionId: crypto.randomUUID(),
          expectedRevision: session.value.revision,
          branchId: session.value.branchId,
          kind,
          channel: kind === 'message' && channel.value !== 'group' ? 'private' : 'group',
          ...(kind === 'message' ? { text: input.value.trim() } : {}),
          ...(choiceId ? { choiceId } : {}),
          ...(kind === 'message' && channel.value !== 'group'
            ? { recipientId: channel.value as 'lin' | 'zhou' | 'xu' }
            : {}),
        }
  pending.value = action
  await remember()
  controller = new AbortController()
  streamMessages = []
  streamPreview.value = []
  let committed = false
  try {
    const response = await fetch(`/api/sessions/${sessionId}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': identity.value.csrfToken ?? '' },
      body: JSON.stringify(action),
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.message || body.statusMessage || `请求失败 (${response.status})`)
    }
    await readJsonlStream(
      response,
      (frame) => {
        if (frame.sessionId !== sessionId || frame.branchId !== action.branchId)
          throw new Error('响应归属不符，请重新同步')
        if (frame.type === 'tool_status') statusText.value = frame.payload.label
        // Buffered, validated, already saved text; display projection never mutates authoritative state.
        if (!preferences.showAllText && frame.type === 'message_start')
          streamMessages.push({ id: frame.payload.messageId, speakerId: frame.payload.speakerId, text: '' })
        if (!preferences.showAllText && frame.type === 'message_delta') {
          const message = streamMessages.find((m) => m.id === frame.payload.messageId)
          if (message) message.text += frame.payload.text
          if (!raf)
            raf = requestAnimationFrame(() => {
              streamPreview.value = streamMessages.map((m) => ({ ...m }))
              raf = 0
            })
        }
        if (frame.type === 'turn_committed') committed = true
        if (frame.type === 'turn_failed') throw new Error(frame.payload.message)
      },
      controller.signal,
    )
    if (!committed) throw new Error('未收到提交确认，正在保留你的输入')
    await load(action.branchId)
    pending.value = null
    if (kind === 'message') {
      input.value = ''
      panel.value = 'history'
    }
    await remember()
  } catch (e) {
    error.value = errorText(e)
    statusText.value = '连接中断或操作未确认'
    await recover().catch(() => undefined)
  } finally {
    busy.value = false
    controller = undefined
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    streamPreview.value = []
  }
}
async function fork(eventSeq: number) {
  if (!session.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await mutate<Session>(`/api/sessions/${sessionId}/fork`, {
      branchId: session.value.branchId,
      eventSeq,
    })
    session.value = result
    panel.value = null
    pending.value = null
    await remember()
    statusText.value = '已创建新分支，旧路线仍然保留'
  } catch (e) {
    error.value = errorText(e)
  } finally {
    busy.value = false
  }
}
async function loadHistory(older = false) {
  if (!session.value) return
  try {
    const result = await $fetch<{ messages: Message[]; hasMore: boolean; nextBeforeEventSeq: number | null }>(
      `/api/sessions/${sessionId}/history`,
      {
        query: {
          branchId: session.value.branchId,
          ...(older && historyCursor.value ? { beforeEventSeq: historyCursor.value } : {}),
        },
      },
    )
    historyPage.value = result.messages
    hasMoreHistory.value = result.hasMore
    historyCursor.value = result.nextBeforeEventSeq
  } catch (e) {
    error.value = errorText(e)
  }
}
async function discardPending() {
  if (!pending.value) return
  const turn = await $fetch<{ status: string }>(`/api/sessions/${sessionId}/turn`, {
    query: { clientActionId: pending.value.clientActionId },
  })
  if (turn.status === 'committed') {
    await recover()
    return
  }
  if (turn.status === 'running') {
    statusText.value = '服务端仍在生成，请稍后查询结果'
    return
  }
  pending.value = null
  await remember()
  await load()
  error.value = ''
  statusText.value = '已同步，可重新选择。原输入仍保留。'
}
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const targets = Array.from(
    document.querySelectorAll<HTMLElement>(
      '.side-panel button:not(:disabled), .side-panel a, .side-panel input, .side-panel textarea, .side-panel select',
    ),
  ).filter((el) => el.offsetParent !== null)
  const first = targets[0],
    last = targets.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
async function openJournal() {
  const requestId = ++journalRequest
  panel.value = 'journal'
  journalStatus.value = ''
  journal.value = ''
  journalBusy.value = true
  try {
    const saved = await $fetch<{ text: string }>(`/api/sessions/${sessionId}/journal`, {
      query: { branchId: session.value?.branchId },
    })
    if (requestId === journalRequest) journal.value = saved.text
  } catch (e) {
    if (requestId === journalRequest) journalStatus.value = errorText(e)
  } finally {
    if (requestId === journalRequest) journalBusy.value = false
  }
}
async function saveJournal() {
  if (journalBusy.value) return
  journalBusy.value = true
  try {
    await mutate(`/api/sessions/${sessionId}/journal`, {
      text: journal.value,
      branchId: session.value?.branchId,
    })
    journalStatus.value = '已保存，仅你可见。'
  } catch (e) {
    journalStatus.value = errorText(e)
  } finally {
    journalBusy.value = false
  }
}
async function switchBranch(id: string) {
  try {
    await load(id)
    panel.value = null
    pending.value = null
    await remember()
  } catch (e) {
    error.value = errorText(e)
  }
}
function networkChanged() {
  online.value = navigator.onLine
  if (online.value) void recover().catch(() => undefined)
}
watch(input, remember)
watch(panel, async (value, previous) => {
  if (value && !previous) panelTrigger = document.activeElement as HTMLElement | null
  if (value === 'history') await loadHistory()
  if (value) {
    await nextTick()
    document.querySelector<HTMLButtonElement>('.side-panel-header button')?.focus()
  } else {
    panelTrigger?.focus()
  }
})
onMounted(() => {
  online.value = navigator.onLine
  window.addEventListener('online', networkChanged)
  window.addEventListener('offline', networkChanged)
  void boot()
})
onBeforeUnmount(() => {
  window.removeEventListener('online', networkChanged)
  window.removeEventListener('offline', networkChanged)
  controller?.abort()
})
useHead({ title: '栖木工作室 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
<template>
  <main id="main" class="game-shell" :class="{ 'text-only': preferences.textOnly }">
    <header class="game-header">
      <BrandMark />
      <div class="game-title">上线前的最后一小时<small>软件测试工程师 / 栖木工作室</small></div>
      <div class="game-toolbar">
        <button class="subtle-button" @click="panel = 'history'">对话</button
        ><button class="subtle-button" @click="openJournal">手账</button
        ><button class="subtle-button" aria-label="体验设置" @click="panel = 'settings'">设置</button
        ><NuxtLink class="subtle-button" to="/saves">退出</NuxtLink>
      </div>
    </header>
    <div v-if="!session" class="loading-state">
      <p>{{ statusText }}</p>
      <p v-if="error" class="error-message" role="alert">{{ error }}</p>
      <button class="secondary-button" @click="boot">重新读取</button>
    </div>
    <div v-else class="game-layout">
      <div class="scene-topline">
        <span class="scene-location"
          ><span class="status-dot" /> {{ session.node.title }}
          <span class="muted"
            >/ {{ 17 + Math.floor(session.state.minute / 60) }}:{{
              String(session.state.minute % 60).padStart(2, '0')
            }}</span
          ></span
        ><span class="save-status" role="status">{{ statusText }}</span>
      </div>
      <div v-if="!online" class="notice" role="status">
        已离线。输入暂存在本机，重新联网后核对服务器存档。
      </div>
      <div class="scene-stage">
        <ArtImage
          v-if="!preferences.textOnly"
          :asset-id="`bg_${session.node.backgroundId}_day_wide`"
          alt="当前工作场景"
          eager
          class="scene-background"
        /><ArtImage
          v-if="character && !preferences.textOnly"
          :asset-id="`chr_${character}_work_half_${mainMessage?.expression || 'neutral'}`"
          :alt="`${mainPerson.name}，${mainPerson.role}`"
          eager
          class="scene-person"
        /><span class="scene-tag"
          >DAY 01 · {{ session.state.perspective === 'product' ? '产品视角短片段' : '你的第一天' }}</span
        >
        <div class="cast-badges">
          <button
            v-for="id in castIds"
            :key="id"
            :aria-label="`私聊${people[id].name}`"
            @click="openPrivateChat(id)"
          >
            <ArtImage :asset-id="`avatar_${id}_neutral`" :alt="people[id].name">{{
              people[id].initial
            }}</ArtImage>
          </button>
        </div>
      </div>
      <section class="dialogue-card" aria-label="剧情与行动">
        <div class="dialogue-heading">
          <span class="speaker-name">{{ mainPerson.name }}</span
          ><span class="speaker-role">{{ mainPerson.role }}</span
          ><span class="provider-badge"
            >原创合成 · {{ session.provider === 'mock' ? '模拟对话' : '在线 AI 对话' }}</span
          >
        </div>
        <p class="dialogue-text">{{ mainMessage?.text || session.node.messages[0]?.text }}</p>
        <p
          v-for="message in recentMessages.filter((m) => m.id !== mainMessage?.id)"
          :key="message.id"
          class="dialogue-extra"
        >
          <strong>{{ people[message.speakerId].name }}</strong
          >{{ message.text }}
        </p>
        <div v-if="session.lastIntent && session.lastIntent.confidence >= 0.9 && !isEnded" class="notice">
          你的消息还没有执行行动。<button
            class="secondary-button"
            :disabled="busy || !!pending"
            @click="confirmIntent"
          >
            {{ session.lastIntent.confirmationLabel }}
          </button>
        </div>
        <div v-else-if="session.lastIntent?.kind === 'clarify'" class="notice">
          {{ session.lastIntent.confirmationLabel }}
        </div>
        <div v-if="isEnded" class="ended-banner">
          <h2>今天的故事，先停在这里。</h2>
          <p>没有适配分数。你可以留下一点感受，也可以直接离开。</p>
          <button class="primary-button" @click="openJournal">写一页手账 ↗</button
          ><button class="subtle-button" @click="panel = 'history'">回看选择，开一条新路线</button>
        </div>
        <div v-else class="choice-grid">
          <button
            v-for="(choice, index) in session.choices"
            :key="choice.id"
            class="choice-button"
            :disabled="busy || !online || !!pending"
            @click="act('choice', choice.id)"
          >
            <span class="choice-key">{{ String(index + 1).padStart(2, '0') }}</span
            ><span
              ><strong>{{ choice.label }}</strong
              ><small>{{ choice.description }}</small></span
            >
          </button>
        </div>
        <div class="game-utility">
          <div>
            <button class="subtle-button" :disabled="busy || !!pending" @click="act('explain')">
              读一张材料卡</button
            ><button
              class="subtle-button"
              :disabled="busy || isEnded || !!pending"
              @click="act('switch_role')"
            >
              换个职责看一眼
            </button>
          </div>
          <div>
            <button class="subtle-button" @click="panel = 'branches'">路线与存档</button
            ><button class="subtle-button" :disabled="busy || isEnded || !!pending" @click="act('leave')">
              交接下班 ↗
            </button>
          </div>
        </div>
        <template v-if="!isEnded"
          ><div class="channel-picker">
            <label for="channel">发给</label
            ><select id="channel" v-model="channel">
              <option value="group">项目工作群</option>
              <option value="lin">林澄 · 私聊</option>
              <option value="zhou">周砚 · 私聊</option>
              <option value="xu">许知 · 私聊</option></select
            ><span class="muted">{{
              channel === 'group' ? '三位同事都能看见' : '只有选中的同事能看见'
            }}</span>
          </div>
          <form class="chat-compose" @submit.prevent="act('message')">
            <label for="chat-input" class="sr-only">你的消息</label
            ><textarea
              id="chat-input"
              v-model="input"
              rows="1"
              maxlength="2000"
              placeholder="也可以说说你的想法，或问一个问题…"
            /><button
              class="primary-button"
              :disabled="busy || !input.trim() || !online || !!pending"
              type="submit"
            >
              发送 ↑
            </button>
          </form>
          <p class="compose-hint">自由对话不代表工作已执行；确认行动请使用上方选项。Enter 换行。</p></template
        >
        <div v-if="busy && !preferences.showAllText" aria-live="off">
          <p v-for="preview in streamPreview" :key="preview.id" class="dialogue-extra">
            <strong>{{ people[preview.speakerId].name }}</strong
            >{{ preview.text }}
          </p>
        </div>
        <div v-if="busy" class="notice" role="status">
          {{ statusText }} <button class="subtle-button" @click="controller?.abort()">停止等待</button>
        </div>
        <div v-if="error" class="error-message" role="alert">{{ error }}</div>
        <div v-if="pending && !busy" class="notice">
          上一次行动还未确认。<button
            class="subtle-button"
            @click="act(pending!.kind, pending!.choiceId, true)"
          >
            原编号重试</button
          ><button class="subtle-button" @click="recover">查询保存结果</button
          ><button class="subtle-button" @click="discardPending">同步后重新选择</button>
        </div>
      </section>
      <div class="game-bottomline">
        <span>虚构人物与团队 · 你可以尝试，也可以不知道</span
        ><span>内容 v{{ session.packVersion }} · 服务端自动保存</span>
      </div>
    </div>
    <div
      v-if="panel"
      class="panel-backdrop"
      @click.self="panel = null"
      @keydown.esc="panel = null"
      @keydown="trapFocus"
    >
      <section
        class="side-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="
          { history: '已保存的对话', journal: '私人手账', settings: '体验设置', branches: '路线与存档' }[
            panel
          ]
        "
      >
        <div class="side-panel-header">
          <h2>
            {{
              {
                history: '已保存的对话',
                journal: '我的一页手账',
                settings: '按舒服的方式体验',
                branches: '每一次选择，都留下来',
              }[panel]
            }}
          </h2>
          <button class="subtle-button" aria-label="关闭面板" @click="panel = null">关闭 ×</button>
        </div>
        <template v-if="panel === 'history'"
          ><div class="tabs" role="tablist" aria-label="对话频道">
            <button role="tab" :aria-selected="channel === 'group'" @click="channel = 'group'">工作群</button
            ><button
              v-for="id in castIds"
              :key="id"
              role="tab"
              :aria-selected="channel === id"
              @click="channel = id"
            >
              {{ people[id].name }}
            </button>
          </div>
          <p class="muted">展示已提交的实际文本。回溯保留原路线，不让人物知道未来。</p>
          <div v-if="session?.lastIntent && session.lastIntent.confidence >= 0.9 && !isEnded" class="notice">
            这条消息还没有执行行动。<button
              class="secondary-button"
              :disabled="busy || !!pending"
              @click="confirmIntent"
            >
              {{ session.lastIntent.confirmationLabel }}
            </button>
          </div>
          <article
            v-for="m in selectedMessages"
            :key="m.id"
            class="chat-message"
            :class="{ player: m.speakerId === 'player' }"
          >
            <header>
              {{ people[m.speakerId].name
              }}<small
                >{{
                  m.channel === 'private'
                    ? '私聊'
                    : m.channel === 'explanation'
                      ? '仅你可见的材料卡'
                      : '工作群'
                }}
                · #{{ m.eventSeq }}</small
              >
            </header>
            <p>{{ m.text }}</p>
            <button
              v-if="m.speakerId === 'narrator' || m.speakerId === 'lin'"
              class="history-action"
              :disabled="busy"
              @click="fork(m.eventSeq)"
            >
              从这里另开一条路线
            </button>
          </article>
          <div class="game-utility">
            <button v-if="hasMoreHistory" class="secondary-button" @click="loadHistory(true)">
              查看更早记录</button
            ><button class="subtle-button" @click="loadHistory()">回到最近记录</button>
          </div>
          <p v-if="!selectedMessages.length" class="empty-state">这个频道还没有对话。</p></template
        >
        <template v-if="panel === 'journal'"
          ><p class="muted">只属于你，不会发送给同事、老师或内容编辑。可以写“不知道”，也可以留白。</p>
          <label class="sr-only" for="journal">手账内容</label
          ><textarea
            id="journal"
            v-model="journal"
            :disabled="journalBusy"
            class="journal-input"
            maxlength="10000"
            placeholder="刚才有什么让你感到意外？也可以只记下一句话。"
          />
          <div class="game-utility">
            <button class="primary-button" :disabled="journalBusy" @click="saveJournal">保存这一页</button
            ><button class="subtle-button" @click="panel = null">暂时不总结</button>
          </div>
          <p class="notice" role="status">
            {{ journalBusy ? '正在同步这一页…' : journalStatus || '手账是自愿的，不影响任何路线。' }}
          </p></template
        >
        <template v-if="panel === 'settings'"
          ><label
            v-for="setting in preferenceOptions"
            :key="setting[0]"
            class="settings-row"
            ><input v-model="preferences[setting[0]]" type="checkbox" @change="preferences.save()" />{{
              setting[1]
            }}</label
          >
          <p class="notice">首版默认静音，无需音频即可完整游玩。偏好仅保存在当前浏览器。</p>
          <NuxtLink class="secondary-button" to="/account">账号与数据管理 ↗</NuxtLink></template
        >
        <template v-if="panel === 'branches'"
          ><p class="muted">每条分支独立保存人物所知与实际对话。作者剧情汇合不会合并你的存档。</p>
          <article v-for="branch in session?.branches" :key="branch.id" class="branch-item">
            <strong>{{ branch.label || '探索路线' }}</strong>
            <p>{{ branch.parentBranchId ? `从事件 ${branch.forkEventSeq} 分出` : '第一次进入的路线' }}</p>
            <button
              class="subtle-button"
              :disabled="branch.id === session?.branchId"
              @click="switchBranch(branch.id)"
            >
              {{ branch.id === session?.branchId ? '正在这条路线' : '读取这条路线' }}
            </button>
          </article>
          <button class="secondary-button" @click="panel = 'history'">从历史节点创建新分支</button></template
        >
      </section>
    </div>
  </main>
</template>
