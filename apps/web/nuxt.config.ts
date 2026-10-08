export default defineNuxtConfig({
  compatibilityDate: '2026-10-08',
  modules: ['@nuxt/ui', '@pinia/nuxt', '@nuxt/eslint'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  typescript: { strict: true },
  // Nuxt 4.6/Nitro 2.13 Windows path normalization: nuxt/nuxt#36467.
  nitro: {
    preset: 'node-server',
    externals: {
      external: ['better-sqlite3', 'argon2'],
      inline: [/[\\/]node_modules[\\/]nuxt[\\/]dist[\\/]/],
    },
  },
  routeRules: {
    '/api/**': { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } },
    '/play/**': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/account': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/saves': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/endings': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/admin': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/feedback': { ssr: false, headers: { 'cache-control': 'private, no-store' } },
    '/art/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/art/manifest.json': { headers: { 'cache-control': 'public, max-age=0, must-revalidate' } },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'zh-CN' },
      title: '职境漫游 CareerScape · 在故事里，看见工作的样子',
      meta: [
        {
          name: 'description',
          content:
            '进入一个虚构的工作日，与同事交流、尝试和选择。面向大学生的职业体验，允许不知道，也允许随时下班。',
        },
        { name: 'theme-color', content: '#F7F4EE' },
      ],
    },
  },
})
