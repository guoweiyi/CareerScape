<script setup lang="ts">
import type { EndingsDTO } from '../../server/services/endings'
const { ensure, identity } = useIdentity()
const result = ref<EndingsDTO>({ packs: [] })
const loading = ref(true)
const error = ref('')
const completed = computed(() => result.value.packs.reduce((count, pack) => count + pack.unlocked.length, 0))
async function load() {
  loading.value = true
  error.value = ''
  try {
    await ensure()
    result.value = await $fetch<EndingsDTO>('/api/account/endings')
  } catch {
    result.value = { packs: [] }
    error.value = '暂时无法读取结局回顾。你的旅程仍保存在服务器，可以稍后重试。'
  } finally {
    loading.value = false
  }
}
onMounted(load)
useHead({ title: '走过的结局 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <main id="main" class="page-wrap endings-page">
    <div class="ending-intro">
      <div>
        <p class="eyebrow">THE PATHS YOU HAVE WALKED</p>
        <h1 class="page-title">每一种停靠，都留下自己的故事。</h1>
        <p class="muted">这里记下你实际走到过的结局。随时回来看看，也可以让下一种可能慢慢发生。</p>
      </div>
      <NuxtLink class="secondary-button" to="/saves">回到我的旅程 ↗</NuxtLink>
    </div>
    <p v-if="identity.user?.isGuest" class="notice">
      这是当前游客身份的回顾。<NuxtLink to="/account" class="text-link"
        >注册时勾选认领，可一起保留旅程。</NuxtLink
      >
    </p>
    <div v-if="loading" class="loading-state" role="status">正在整理走过的路…</div>
    <div v-else-if="error" class="error-message" role="alert">
      <p>{{ error }}</p>
      <button class="secondary-button" @click="load">重新读取</button>
    </div>
    <template v-else>
      <div v-if="!result.packs.length" class="panel ending-empty">
        <span class="ending-mark" aria-hidden="true">↗</span>
        <h2>先让一个故事开始。</h2>
        <p class="muted">等一天告一段落，它就会留在这里，和当时的选择一起。</p>
        <NuxtLink class="primary-button" to="/">走进一段职境 ↗</NuxtLink>
      </div>
      <p v-else class="ending-note">
        {{
          completed ? `已经留下 ${completed} 种结局。` : '这段故事还在继续。'
        }}
        这些记录只属于你，不用集齐，也没有适配评分。
      </p>
      <section
        v-for="pack in result.packs"
        :key="pack.packId"
        class="ending-pack"
        :aria-labelledby="`heading-${pack.packId}`"
      >
        <div class="ending-pack-heading">
          <h2 :id="`heading-${pack.packId}`">{{ pack.title }}</h2>
          <span class="muted">已走过 {{ pack.unlocked.length }} 种可能</span>
        </div>
        <div class="ending-grid">
          <article
            v-for="ending in pack.unlocked"
            :key="ending.endingId"
            class="ending-card panel"
            data-testid="unlocked-ending"
          >
            <span class="ending-mark" aria-hidden="true">↗</span>
            <p class="eyebrow">你的故事片段</p>
            <h3>{{ ending.title }}</h3>
            <p class="ending-summary">{{ ending.summary }}</p>
            <div class="ending-card-footer">
              <small
                >第一次走到这里 · {{ new Date(ending.firstCompletedAt).toLocaleDateString('zh-CN')
                }}<br />回看存档 · 内容 v{{ ending.packVersion }}</small
              >
              <NuxtLink
                :to="{ path: `${ending.mode === 'galgame' ? '/galgame' : '/play'}/${ending.sessionId}`, query: { branchId: ending.branchId } }"
                class="secondary-button"
                >回看这条路线 ↗</NuxtLink
              >
            </div>
          </article>
          <article
            v-for="index in Math.max(0, pack.totalEndings - pack.unlocked.length)"
            :key="`unvisited-${index}`"
            class="ending-card ending-unvisited"
            data-testid="locked-ending"
          >
            <span class="ending-mark" aria-hidden="true">· · ·</span>
            <h3>还有一种可能，尚未走到。</h3>
            <p>它的名字与故事，留到相遇时再看。</p>
          </article>
        </div>
      </section>
    </template>
  </main>
</template>

<style scoped>
.endings-page {
  max-width: 1200px;
}
.ending-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 24px;
}
.ending-intro .secondary-button {
  flex-shrink: 0;
  margin-top: 32px;
}
.ending-intro .page-title {
  font-size: clamp(28px, 3.8vw, 44px);
}
.ending-empty {
  text-align: center;
  padding: 48px 24px;
}
.ending-empty p {
  margin: 16px 0 24px;
}
.ending-note {
  color: var(--muted);
  line-height: 1.8;
  margin: 24px 0;
}
.ending-pack {
  margin-top: 36px;
}
.ending-pack-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}
.ending-pack-heading h2 {
  font-size: 24px;
}
.ending-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.ending-card {
  padding: 28px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow-wrap: anywhere;
}
.ending-card h3 {
  font-size: 22px;
  line-height: 1.5;
  margin: 10px 0;
}
.ending-mark {
  display: inline-grid;
  place-items: center;
  color: var(--primary);
  border: 1px solid var(--line);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  font-family: Georgia, serif;
  font-size: 28px;
  margin-bottom: 24px;
}
.ending-summary {
  line-height: 1.9;
  font-size: 15px;
  white-space: pre-line;
}
.ending-card-footer {
  margin-top: auto;
  padding-top: 28px;
  width: 100%;
}
.ending-card-footer small {
  display: block;
  color: var(--muted);
  line-height: 1.8;
  margin-bottom: 18px;
}
.ending-unvisited {
  border: 1px dashed #b4c2b4;
  border-radius: 20px;
  background: #edf0e7;
  min-height: 300px;
  justify-content: center;
  color: #5c6962;
}
.ending-unvisited h3 {
  font-size: 18px;
}
.ending-unvisited p {
  line-height: 1.8;
}
@media (max-width: 850px) {
  .ending-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .ending-intro {
    display: block;
  }
  .ending-intro .secondary-button {
    margin-top: 20px;
  }
}
@media (max-width: 580px) {
  .ending-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .ending-unvisited {
    min-height: 200px;
  }
}
</style>
