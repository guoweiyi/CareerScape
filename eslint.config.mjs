import withNuxt from './apps/web/.nuxt/eslint.config.mjs'
export default withNuxt({ ignores: ['art/**', 'docs/**', 'apps/web/public/**', 'pnpm-lock.yaml'] }, {
  rules: { '@typescript-eslint/no-explicit-any': 'error', 'vue/multi-word-component-names': 'off', 'vue/html-self-closing': 'off' },
})
