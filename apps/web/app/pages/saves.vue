<script setup lang="ts">
import type { SessionSummary } from '~/types/game'
const { ensure, identity } = useIdentity()
const sessions = ref<SessionSummary[]>([])
const loading = ref(true)
const error = ref('')
const exporting = ref('')
async function exportSession(id: string) {
  exporting.value = id; error.value = ''
  try {
    const archive = await $fetch('/api/account/export', { query: { sessionId: id } })
    const url = URL.createObjectURL(new Blob([JSON.stringify(archive)], { type: 'application/json' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `careerscape-${id}.json`; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch { error.value = '暂时无法导出这段旅程，请稍后重试。' } finally { exporting.value = '' }
}
onMounted(async () => {
  try {
    await ensure()
    sessions.value = (await $fetch<{ sessions: SessionSummary[] }>('/api/sessions')).sessions
  } catch (e) {
    error.value = e instanceof Error ? e.message : '暂时无法读取'
  } finally {
    loading.value = false
  }
})
useHead({ title: '我的旅程 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
<template>
  <main id="main" class="page-wrap">
    <p class="eyebrow">YOUR POSSIBLE DAYS</p>
    <h1 class="page-title">每走过一天，都有迹可循。</h1>
    <p class="muted">保存的是你当时做出的选择与对话。回来时，故事会从那里继续。</p>
    <NuxtLink class="secondary-button" to="/endings" style="margin-top: 16px; margin-bottom: 20px"
      >回顾走过的结局 ↗</NuxtLink
    >
    <p v-if="identity.user?.isGuest" class="notice">
      你正在使用游客身份。<NuxtLink class="text-link" to="/account">注册并认领这些旅程 ↗</NuxtLink>
    </p>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <div v-if="loading" class="loading-state">正在读取你的旅程…</div>
    <div v-else-if="!sessions.length" class="empty-state">
      <h2>这里还没有脚印。</h2>
      <p>先走进一天，不用急着决定未来。</p>
      <NuxtLink class="primary-button" to="/">去看看开放的职境 ↗</NuxtLink>
    </div>
    <div v-else class="save-list">
      <article v-for="save in sessions" :key="save.id" class="panel save-item">
        <div>
          <p class="eyebrow">{{ save.mode === 'galgame' ? 'AI 职业故事 · 虚构工作案例' : '栖木工作室 · 原创合成' }}</p>
          <h2>{{ save.title }}</h2>
          <small
            >{{ save.status === 'ended' ? '这一天已告一段落' : '故事还在继续' }} · 修订
            {{ save.revision }}</small
          ><small>最近保存：{{ new Date(save.updatedAt).toLocaleString('zh-CN') }}</small>
        </div>
        <div class="gal-save-actions"><NuxtLink :to="`${save.mode === 'galgame' ? '/galgame' : '/play'}/${save.id}`" class="primary-button">回到这一天 ↗</NuxtLink><button class="text-link" :disabled="Boolean(exporting)" @click="exportSession(save.id)">{{ exporting === save.id ? '正在导出…' : '导出这段旅程' }}</button></div>
      </article>
    </div>
  </main>
</template>
