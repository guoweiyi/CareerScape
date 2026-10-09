import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { chromium, expect, type Page } from '@playwright/test'
import { modelConfig, roleProviderName } from '../packages/agent/models'
import type { GalgameSessionDTO } from '../packages/contracts/galgame'
import { invariant, now } from '../packages/database'

const provider = roleProviderName()
invariant(provider !== 'mock' && modelConfig(provider).available && !modelConfig(provider).model.includes('test-fixture'), 'LIVE_CONFIG_REQUIRED', 503, '需要真实模型配置。')
const config = modelConfig(provider)
const reservation = createServer()
await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve))
const port = (reservation.address() as { port: number }).port
await new Promise<void>(resolve => reservation.close(() => resolve()))
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
  cwd: process.cwd(), windowsHide: true, stdio: 'ignore',
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', APP_ORIGIN: origin,
    DATABASE_PATH: resolve(`.data/google-browser-${Date.now()}.sqlite`), GALGAME_ENABLED: '1', COOKIE_SECURE: 'false' },
})
let spawnFailed = false
server.on('error', () => { spawnFailed = true })
const checks: string[] = []
let stage = 'startup'
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
async function snapshot(page: Page) {
  return await page.evaluate(async () => {
    const response = await fetch(`/api/sessions/${location.pathname.split('/').at(-1)}`)
    return await response.json()
  }) as GalgameSessionDTO
}
async function finishReading(page: Page) {
  await expect(page.locator('.gal-generation')).toHaveCount(0)
  for (let i = 0; i < 8 && !await page.locator('.gal-read-done').isVisible(); i++) {
    const show = page.getByRole('button', { name: '显示整句', exact: true })
    if (await show.isVisible()) await show.click()
    const next = page.getByRole('button', { name: '下一句', exact: false })
    if (await next.isVisible()) await next.click()
  }
}
try {
  const deadline = Date.now() + 30000
  while (true) {
    invariant(!spawnFailed && server.exitCode === null, 'LIVE_SERVER_FAILED', 503, '测试服务未能启动。')
    if (await fetch(`${origin}/api/health`).then(response => response.ok).catch(() => false)) break
    invariant(Date.now() < deadline, 'LIVE_SERVER_TIMEOUT', 503, '测试服务启动超时。')
    await pause(300)
  }
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  page.setDefaultTimeout(15000)
  await page.addInitScript(() => localStorage.setItem('careerscape-preferences', JSON.stringify({ galgameInstantText: true })))
  stage = 'galgame-opening'
  await page.goto(`${origin}/galgame`)
  await page.getByLabel('名字', { exact: true }).fill('真实验收小禾')
  await page.getByRole('radio', { name: /应届/ }).check()
  await page.getByRole('button', { name: /以这个身份，走进故事/ }).click()
  await expect(page).toHaveURL(/\/galgame\/.+/)
  await expect.poll(async () => (await snapshot(page)).status, { timeout: 75000 }).toBe('active')
  await finishReading(page)
  const opening = await snapshot(page)
  invariant(opening.provider === 'google', 'LIVE_PROVIDER', 422, '页面未使用Google供应商。')
  checks.push('真实职业入口、身份和开场')
  stage = 'galgame-private'
  await page.getByRole('combobox', { name: '对话对象', exact: true }).selectOption('zhou')
  await page.getByLabel('自由行动或提问').fill('请私下解释你收到的合成案例线索，标注尚未实际验证的事项。')
  await page.getByRole('button', { name: /把下一步交给故事/ }).click()
  await expect.poll(async () => (await snapshot(page)).revision, { timeout: 75000 }).toBe(opening.revision + 1)
  await finishReading(page)
  await expect(page.locator('.gal-private-label')).toBeVisible()
  const privateState = await snapshot(page), url = page.url()
  invariant(privateState.messages.filter(message => message.eventSeq === privateState.eventSeq).every(message => message.channel === 'private' && message.recipientId === 'zhou'), 'LIVE_PRIVACY', 422, '私聊范围错误。')
  await page.reload()
  await expect(page.locator('.gal-stage')).toBeVisible()
  await finishReading(page)
  invariant((await snapshot(page)).revision === privateState.revision, 'LIVE_RELOAD', 422, '刷新生成了新回合。')
  checks.push('真实私聊、刷新与已提交对白恢复')
  mkdirSync('test-results', { recursive: true })
  await expect.poll(async () => await page.locator('.gal-figure img').evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.screenshot({ path: 'test-results/google-live-390.png', fullPage: true })
  invariant(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'LIVE_LAYOUT', 422, '手机页面溢出。')
  await page.getByRole('button', { name: '保存并下班', exact: true }).click()
  await expect(page.locator('.gal-finish-panel')).toBeVisible()
  await page.goto(`${origin}/saves`)
  await page.getByRole('link', { name: '回到这一天 ↗' }).first().click()
  await expect(page).toHaveURL(url)
  await expect(page.locator('.gal-finish-panel')).toBeVisible()
  checks.push('保存、下班与存档入口恢复')
  stage = 'legacy-browser'
  const storyId = await page.evaluate(async () => {
    const { csrfToken } = await (await fetch('/api/me')).json()
    const catalog = await (await fetch('/api/catalog')).json()
    const response = await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify({ packId: catalog.occupations[0].packId, seed: 'google-browser-legacy' }) })
    if (!response.ok) throw new Error('Legacy creation failed')
    return (await response.json()).id as string
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`${origin}/play/${storyId}`)
  await expect(page.locator('.provider-badge')).toContainText('在线 AI 对话')
  await page.getByLabel('你的消息').fill('请根据你实际收到的材料，用一段简短中文说明今天的工作。')
  await page.getByRole('button', { name: '发送 ↑' }).click()
  await expect.poll(async () => await page.evaluate(async id => (await (await fetch(`/api/sessions/${id}`)).json()).revision, storyId), { timeout: 45000 }).toBe(1)
  await page.reload()
  await expect(page.locator('.save-status')).toContainText('已保存')
  await expect.poll(async () => await page.locator('.scene-background img').evaluateAll(images => images.length > 0 && images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true)
  await page.screenshot({ path: 'test-results/google-live-1440.png', fullPage: true })
  invariant(!errors.length, 'LIVE_PAGE_ERROR', 422, '页面出现运行异常。')
  checks.push('旧剧情真实对话、在线标识与刷新恢复')
  writeFileSync('test-results/ai-browser-live.json', JSON.stringify({ checkedAt: now(), status: 'passed', provider, model: config.model, checks, pageErrors: errors }, null, 2))
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, report: 'test-results/ai-browser-live.json' }))
} catch (error) {
  const code = (error as { code?: string }).code || 'LIVE_BROWSER_FAILED'
  mkdirSync('test-results', { recursive: true })
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: 'test-results/google-live-failure.png', fullPage: true }).catch(() => {})
  writeFileSync('test-results/ai-browser-live.json', JSON.stringify({ checkedAt: now(), status: 'failed', provider, model: config.model, stage, code, errorType: (error as Error).name, checks }, null, 2))
  console.error(JSON.stringify({ status: 'failed', stage, code, errorType: (error as Error).name }))
  process.exitCode = 1
} finally {
  await browser?.close()
  server.kill()
  if (server.exitCode === null) await Promise.race([new Promise<void>(resolve => server.once('exit', () => resolve())), pause(5000)])
}
