<script setup lang="ts">
const route = useRoute()
const preferences = usePreferences(usePinia())
onMounted(() => preferences.restore())
</script>
<template>
  <UApp
    ><div :class="{ 'reduced-motion': preferences.reducedMotion }">
      <a href="#main" class="skip-link">跳到主要内容</a>
      <header v-if="!route.path.startsWith('/play/')" class="site-header">
        <BrandMark />
        <nav aria-label="主导航">
          <NuxtLink to="/">探索职业</NuxtLink><NuxtLink to="/saves">我的旅程</NuxtLink
          ><NuxtLink class="nav-account" to="/account">个人空间 <span aria-hidden="true">↗</span></NuxtLink>
        </nav>
      </header>
      <NuxtPage />
      <footer v-if="!route.path.startsWith('/play/')" class="site-footer">
        <span>每一种工作，都值得走近一点。</span><span>原创合成演示 · 不作职业适配诊断</span
        ><NuxtLink to="/feedback">自愿反馈</NuxtLink><NuxtLink to="/admin">内容工作台</NuxtLink>
      </footer>
    </div></UApp
  >
</template>
