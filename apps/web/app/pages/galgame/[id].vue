<script setup lang="ts">
definePageMeta({ key: (route) => String(route.params.id) })
const route = useRoute(),
  sessionId = String(route.params.id)
const { session, busy, error, progress, pending, act, retry, discard, switchBranch, fork } =
  useGalgameSession(sessionId)
const text = ref(''),
  recipient = ref('group'),
  actionKind = ref<'act' | 'message'>('act'),
  readComplete = ref(false)
const canAct = computed(() => !busy.value && !pending.value && readComplete.value)
const disabled = computed(() => busy.value || Boolean(pending.value))
provide(
  'artManifestVersion',
  computed(() => session.value?.assetManifestVersion || 'current'),
)
async function sendText() {
  if (!text.value.trim() || !canAct.value) return
  const input = text.value.trim()
  if (recipient.value !== 'group')
    await act({
      kind: 'message',
      text: input,
      channel: 'private',
      recipientId: recipient.value as 'lin' | 'zhou' | 'xu',
    })
  else await act({ kind: actionKind.value, text: input })
  if (!pending.value) text.value = ''
}
watch(
  () => session.value?.branchId,
  () => {
    text.value = ''
    recipient.value = 'group'
    readComplete.value = false
  },
)
useHead({ title: '我的 AI 职业故事 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
<template>
  <main id="main" class="gal-player">
    <header class="gal-player-header">
      <NuxtLink to="/saves" class="text-link">← 我的旅程</NuxtLink>
      <div>
        <span class="eyebrow">AI CAREER STORY</span>
        <h1>{{ session?.title || '你的职业故事' }}</h1>
      </div>
      <label v-if="session && session.branches.length > 1" class="gal-branch-select"
        ><span class="sr-only">切换路线</span
        ><select
          :value="session.branchId"
          :disabled="disabled"
          @change="switchBranch(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="branch in session.branches" :key="branch.id" :value="branch.id">
            {{ branch.label }}
          </option>
        </select></label
      ><button
        v-if="session && session.status !== 'ended'"
        class="secondary-button gal-leave"
        :disabled="disabled"
        @click="act({ kind: 'leave' })"
      >
        保存并下班
      </button>
    </header>
    <div v-if="error" class="gal-error" role="alert">
      <p>{{ error }}</p>
      <template v-if="pending"
        ><button class="secondary-button" :disabled="busy" @click="retry">查询并重试同一行动</button
        ><button class="text-link" :disabled="busy" @click="discard">查询后更换行动</button></template
      ><button
        v-else-if="session?.status === 'preparing'"
        class="secondary-button"
        :disabled="busy"
        @click="act({ kind: 'begin' })"
      >
        重新准备开场</button
      ><NuxtLink v-else to="/saves" class="text-link">回到我的旅程</NuxtLink>
    </div>
    <div v-if="session" class="gal-player-grid">
      <div class="gal-main-column">
        <GalgameStage :session="session" :busy="busy" @read-complete="readComplete = $event" />
        <div v-if="busy" class="gal-generation" role="status">
          <span class="gal-loading-dot" />{{ progress || '正在回应你的行动…' }}
        </div>
        <section v-if="session.status === 'preparing' && !error" class="gal-actions">
          <p>你好，{{ session.player.name }}。工位已保存，故事从这里开始。</p>
          <button class="primary-button" :disabled="disabled" @click="act({ kind: 'begin' })">
            开始今天的工作 ↗
          </button>
        </section>
        <section v-if="session.status === 'active'" class="gal-actions" aria-label="你的下一步行动">
          <template v-if="readComplete"
            ><p class="eyebrow">WHAT WOULD YOU DO?</p>
            <div class="gal-choices">
              <button
                v-for="(choice, index) in session.choices"
                :key="choice.id"
                class="gal-choice"
                :disabled="disabled"
                @click="act({ kind: 'choice', choiceId: choice.id })"
              >
                <span>{{ String(index + 1).padStart(2, '0') }}</span
                >{{ choice.label }}<span aria-hidden="true">↗</span>
              </button>
            </div></template
          >
          <p v-else class="gal-reading-hint">先听完这一段，再决定怎么做。可以点击“显示整句”加快阅读。</p>
          <form class="gal-input-form" @submit.prevent="sendText">
            <div class="gal-input-mode">
              <label
                ><span class="sr-only">行动或对话</span
                ><select v-model="actionKind" :disabled="disabled || recipient !== 'group'">
                  <option value="act">我想这样行动</option>
                  <option value="message">我想问一问</option>
                </select></label
              ><label
                ><span class="sr-only">对话对象</span
                ><select v-model="recipient" :disabled="disabled">
                  <option value="group">在团队中交流</option>
                  <option v-for="person in session.characters" :key="person.id" :value="person.id">
                    私聊{{ person.name }}
                  </option>
                </select></label
              >
            </div>
            <label class="sr-only" for="gal-free-input">自由行动或提问</label
            ><textarea
              id="gal-free-input"
              v-model="text"
              rows="2"
              maxlength="2000"
              :disabled="disabled"
              placeholder="可以描述自己的做法，或把不确定的地方问清楚。"
            /><button class="primary-button" :disabled="!canAct || !text.trim()">
              {{ busy ? '正在回应…' : '把下一步交给故事' }} ↗
            </button>
          </form>
        </section>
        <section v-else-if="session.status === 'ended'" class="gal-finish-panel">
          <p class="eyebrow">A PLACE TO PAUSE</p>
          <h2>
            {{
              session.outcome === 'completed'
                ? '你留下了一份可以讨论的工作产物。'
                : '这段工作，先在这里停靠。'
            }}
          </h2>
          <p>行动与对话已经保存。打开右侧或下方的“就业复盘”，看看这段模拟经历可以带来哪些下一步。</p>
          <NuxtLink to="/galgame" class="secondary-button">再试一种职业身份 ↗</NuxtLink>
        </section>
        <p class="gal-case-note">岗位流程有资料依据 · 团队与本局材料为虚构案例 · 产物审阅为 AI 模拟</p>
      </div>
      <GalgameWorkbench
        :session="session"
        :disabled="disabled"
        :can-act="canAct"
        @action="act"
        @fork="fork"
      />
    </div>
    <div v-else-if="!error" class="loading-state" role="status">正在读取你的职业故事…</div>
  </main>
</template>
