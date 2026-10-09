import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test('逐段阅读：仅播放已提交对白，手动与计时控制、关闭/隐藏/回合变化停止且不执行行动', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: '开启第一段职境' }).click()
  await expect(page.locator('.save-status')).toContainText('已保存')
  const sessionId = new URL(page.url()).pathname.split('/').at(-1)!
  const before = await (await page.request.get(`/api/sessions/${sessionId}`)).json()
  let actionsFromReading = 0
  page.on('request', (request) => {
    if (request.url().endsWith(`/api/sessions/${sessionId}/action`)) actionsFromReading++
  })
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 1000))
  await page.getByTestId('open-dialogue-reader').click()
  const reader = page.getByTestId('committed-dialogue')
  await expect(reader).toHaveAttribute('data-playing', 'false')
  await expect(page.getByTestId('reader-progress')).toContainText('第 1 /')
  await expect(page.getByTestId('reader-reduced-motion')).toBeVisible()
  const firstText = await page.getByTestId('reader-text').textContent()
  expect(before.messages.some((message: { text: string }) => message.text === firstText)).toBe(true)
  await page.getByTestId('reader-next').click()
  await expect(page.getByTestId('reader-progress')).toContainText('第 2 /')
  await expect(page.getByTestId('reader-announcement')).toContainText('第 2 段')
  await page.getByTestId('reader-previous').click()
  await expect(page.getByTestId('reader-text')).toHaveText(firstText!)
  await mkdir('test-results/screenshots', { recursive: true })
  await page.screenshot({ path: 'test-results/screenshots/reader-390.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  await page.getByTestId('reader-speed').selectOption('brisk')
  await page.getByTestId('reader-autoplay').click()
  await expect(reader).toHaveAttribute('data-playing', 'true')
  await expect(page.getByTestId('reader-announcement')).toBeEmpty()
  await page.clock.runFor(12001)
  await expect(page.getByTestId('reader-progress')).not.toContainText('第 1 /')
  await page.getByTestId('reader-autoplay').click()
  const stoppedAt = await page.getByTestId('reader-progress').textContent()
  await page.clock.runFor(15000)
  await expect(page.getByTestId('reader-progress')).toHaveText(stoppedAt!)
  await page.getByTestId('reader-autoplay').click()
  await page.clock.runFor(120000)
  await expect(reader).toHaveAttribute('data-playing', 'false')
  await expect(page.getByTestId('reader-status')).toContainText('本回合对白已读完')
  await expect(page.getByTestId('reader-next')).toBeDisabled()
  await page.getByTestId('reader-autoplay').click()
  await expect(page.getByTestId('reader-progress')).toContainText('第 1 /')
  // Exercise the visibility handler in Chromium; this does not claim a real mobile background test.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(reader).toHaveAttribute('data-playing', 'false')
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden')
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(reader).toHaveAttribute('data-playing', 'false')
  await page.getByTestId('reader-autoplay').click()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.clock.runFor(15000)
  await page.getByTestId('open-dialogue-reader').click()
  await expect(reader).toHaveAttribute('data-playing', 'false')
  await expect(page.getByTestId('reader-progress')).toContainText('第 1 /')
  const unchanged = await (await page.request.get(`/api/sessions/${sessionId}`)).json()
  expect(unchanged.revision).toBe(before.revision)
  expect(unchanged.state).toEqual(before.state)
  expect(actionsFromReading).toBe(0)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: 'test-results/screenshots/reader-1440.png' })
  await page.getByTestId('reader-autoplay').click()
  // Simulate another tab's explicit action, then sync the confirmed session while the reader stays open.
  const identity = await (await page.request.get('/api/me')).json()
  const advanced = await page.request.post(`/api/sessions/${sessionId}/action`, {
    headers: { origin: 'http://127.0.0.1:3100', 'x-csrf-token': identity.csrfToken },
    data: {
      clientActionId: crypto.randomUUID(),
      expectedRevision: before.revision,
      branchId: before.branchId,
      kind: 'choice',
      channel: 'group',
      choiceId: before.choices[0].id,
    },
  })
  expect(advanced.ok()).toBe(true)
  expect(await advanced.text()).toContain('turn_committed')
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.locator('.save-status')).toContainText(`修订 ${before.revision + 1}`)
  await expect(reader).toHaveAttribute('data-playing', 'false')
  await expect(page.getByTestId('reader-progress')).toContainText('第 1 /')
  await expect(page.getByTestId('reader-status')).toContainText('当前回合已更新')
  const current = await (await page.request.get(`/api/sessions/${sessionId}`)).json()
  const currentId = await page.getByTestId('reader-message').getAttribute('data-message-id')
  expect(current.messages.some((message: { id: string }) => message.id === currentId)).toBe(true)
})
