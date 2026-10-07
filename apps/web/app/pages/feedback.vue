<script setup lang="ts">
const route = useRoute()
const sessionId = computed(() =>
  typeof route.query.sessionId === 'string' ? route.query.sessionId : undefined,
)
useHead({ title: '自愿反馈 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>

<template>
  <main id="main" class="page-wrap feedback-page">
    <p class="eyebrow">A NOTE FROM YOU</p>
    <h1 class="page-title">有些感受，愿意说给我们听。</h1>
    <p class="muted feedback-intro">这里没有评分，也不需要注册。你的反馈可以帮助我们把故事和体验做得更好。</p>
    <section class="panel" aria-label="自愿反馈表单"><FeedbackForm :session-id="sessionId" /></section>
    <NuxtLink to="/" class="subtle-button">先回到职境漫游 ↗</NuxtLink>
  </main>
</template>

<style scoped>
.feedback-page {
  max-width: 820px;
}
.feedback-intro {
  margin-bottom: 24px;
}
</style>
