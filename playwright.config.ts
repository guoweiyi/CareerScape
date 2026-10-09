import { defineConfig } from '@playwright/test'
import { resolve } from 'node:path'
const databasePath = process.env.E2E_DATABASE_PATH || resolve(`.data/e2e-${Date.now()}.sqlite`)
process.env.E2E_DATABASE_PATH = databasePath
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [{
    command: 'node --import tsx tests/fixtures/galgame-model-server.ts',
    url: 'http://127.0.0.1:3219/health',
    reuseExistingServer: false,
    timeout: 30000,
  }, {
    command: 'node apps/web/.output/server/index.mjs',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: '3100',
      HOST: '127.0.0.1',
      APP_ORIGIN: 'http://127.0.0.1:3100',
      DATABASE_PATH: databasePath,
      AI_PROVIDER: 'google',
      // Explicit test fixture only; the product has no mock Galgame provider.
      GALGAME_ENABLED: '1',
      GOOGLE_GENERATIVE_AI_API_KEY: 'test-only-key',
      GOOGLE_MODEL: 'test-fixture',
      GOOGLE_BASE_URL: 'http://127.0.0.1:3219/v1beta',
      OPENAI_API_KEY: 'test-only-key',
      OPENAI_MODEL: 'test-fixture',
      OPENAI_BASE_URL: 'http://127.0.0.1:3219/v1',
      COOKIE_SECURE: 'false',
    },
  }],
})
