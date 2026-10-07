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
  webServer: {
    command: 'node apps/web/.output/server/index.mjs',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: '3100',
      HOST: '127.0.0.1',
      APP_ORIGIN: 'http://127.0.0.1:3100',
      DATABASE_PATH: databasePath,
      AI_PROVIDER: 'mock',
      COOKIE_SECURE: 'false',
    },
  },
})
