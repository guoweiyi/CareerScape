import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
const browser = await chromium.launch({ headless: true })
await mkdir('docs/screenshots', { recursive: true })
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:3000/', { waitUntil: 'networkidle' })
  await page.locator('#occupations').scrollIntoViewIfNeeded()
  await page.waitForFunction(() => [...document.images].every((image) => image.complete))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `docs/screenshots/home-${viewport.width}.png` })
  await page.screenshot({ path: `docs/screenshots/home-${viewport.width}-full.png`, fullPage: true })
  await page.getByRole('button', { name: '开启第一段职境' }).click()
  await page.waitForURL('**/play/**')
  await page.locator('.save-status').filter({ hasText: '已保存' }).waitFor()
  await page.waitForFunction(() => [...document.querySelectorAll('.scene-stage img')].every(image => image.complete))
  await page.screenshot({ path: `docs/screenshots/play-${viewport.width}.png` })
  await page.screenshot({ path: `docs/screenshots/play-${viewport.width}-full.png`, fullPage: true })
  await page.getByLabel('发给').selectOption('zhou')
  await page.getByLabel('你的消息').fill('在这份工作里，你通常会先确认什么？')
  await page.getByRole('button', { name: '发送 ↑' }).click()
  await page.getByRole('dialog').waitFor()
  await page.screenshot({ path: `docs/screenshots/chat-${viewport.width}.png` })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('button', { name: '手账', exact: true }).click()
  await page.getByLabel('手账内容').fill('今天我想继续了解：怎样判断一个修复已经验证。')
  await page.getByRole('button', { name: '保存这一页' }).click()
  await page.getByRole('dialog').getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.screenshot({ path: `docs/screenshots/journal-${viewport.width}.png` })
  await page.goto('http://127.0.0.1:3000/saves')
  await page.locator('.save-item').waitFor()
  await page.screenshot({ path: `docs/screenshots/saves-${viewport.width}.png` })
  await page.goto('http://127.0.0.1:3000/feedback')
  await page.getByLabel('想和我们说的话', { exact: true }).waitFor()
  await page.screenshot({ path: `docs/screenshots/feedback-${viewport.width}.png` })
  console.log(
    JSON.stringify({
      viewport,
      title: await page.title(),
      horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      errors,
    }),
  )
  await page.close()
}
await browser.close()
