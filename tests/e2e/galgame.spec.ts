import { test, expect, type Page } from '@playwright/test'
import type { GalgameSessionDTO } from '../../packages/contracts/galgame'

async function readSegment(page: Page) {
  await expect(page.locator('.gal-generation')).toHaveCount(0)
  for (let i = 0; i < 6; i++) {
    if (await page.locator('.gal-read-done').isVisible()) break
    const show = page.getByRole('button', { name: '显示整句', exact: true })
    if (await show.isVisible()) await show.click()
    const next = page.getByRole('button', { name: '下一句', exact: false })
    if (await next.isVisible()) await next.click()
  }
  await expect(page.locator('.gal-read-done')).toBeVisible()
}
async function snapshot(page: Page) {
  return (await page.evaluate(
    async () => await (await fetch(`/api/sessions/${location.pathname.split('/').at(-1)}`)).json(),
  )) as GalgameSessionDTO
}
async function enter(page: Page, career: string, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.addInitScript(() =>
    localStorage.setItem(
      'careerscape-preferences',
      JSON.stringify({ galgameInstantText: true, galgameAutoDelay: 3 }),
    ),
  )
  await page.goto('/galgame')
  await expect(page.getByRole('heading', { name: /换一种身份/ })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(career) }).click()
  await page.getByLabel('名字', { exact: true }).fill('林小禾')
  await page.getByRole('radio', { name: /转行/ }).check()
  await page.getByRole('button', { name: '晴日', exact: true }).click()
  await page.getByRole('button', { name: /以这个身份，走进故事/ }).click()
  await expect(page).toHaveURL(/\/galgame\/.+/)
  await expect(page.locator('.gal-stage')).toBeVisible()
  await expect.poll(async () => (await snapshot(page)).revision).toBe(1)
  await readSegment(page)
  await expect(page.locator('.gal-choices')).toBeVisible()
}
for (const [career, width] of [
  ['软件测试', 390],
  ['前端', 1440],
  ['产品', 1024],
] as const) {
  test(`真实API链路（显式模型fixture）：${career}的身份、行动、产物、复盘和保存`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await enter(page, career, width)
    const opening = await snapshot(page)
    expect(opening.player).toMatchObject({ name: '林小禾', identity: 'career-changer', avatar: 'sun' })
    await page.locator('.gal-choice').first().click()
    await expect.poll(async () => (await snapshot(page)).revision).toBe(opening.revision + 1)
    await readSegment(page)
    const current = await snapshot(page)
    for (const field of current.artifactFields)
      await page
        .getByLabel(field.label, { exact: true })
        .fill(`根据本局材料整理${field.label}，注明尚未验证的部分，交给负责人复核；未执行测试或部署。`)
    await page.getByRole('button', { name: /提交给导师审阅/ }).click()
    await expect(page.getByRole('heading', { name: '你留下了一份可以讨论的工作产物。' })).toBeVisible()
    await readSegment(page)
    await page.getByRole('button', { name: '就业复盘', exact: true }).click()
    await page.getByRole('button', { name: /生成就业复盘/ }).click()
    await expect(page.locator('.gal-interview')).toContainText('不是实际任职经历')
    const url = page.url()
    await page.reload()
    await expect(page.locator('.gal-finish-panel')).toBeVisible()
    await page.getByRole('button', { name: '就业复盘', exact: true }).click()
    await expect(page.locator('.gal-interview')).toContainText('模拟职业项目')
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
    await page.screenshot({ path: `test-results/galgame-${width}.png`, fullPage: true })
    await page.goto('/saves')
    await page.getByRole('link', { name: '回到这一天 ↗' }).first().click()
    await expect(page).toHaveURL(url)
    expect(errors).toEqual([])
  })
}
test('私聊、阅读自动播放不提交行动、失败重试与回溯', async ({ page, request }) => {
  await enter(page, '软件测试', 390)
  await page.getByRole('combobox', { name: '对话对象', exact: true }).selectOption('zhou')
  await page.getByLabel('自由行动或提问').fill('只给周砚的私人问题：有什么线索？')
  await page.getByRole('button', { name: /把下一步交给故事/ }).click()
  await expect(page.locator('.gal-private-label')).toBeVisible()
  await readSegment(page)
  expect(await page.locator('.gal-figure').count()).toBe(1)
  await page.getByRole('button', { name: '手账', exact: true }).click()
  await page.getByLabel('这段工作，让你想到了什么？').fill('我的私人感受，不发送给任何角色。')
  await page.getByRole('button', { name: '保存手账', exact: true }).click()
  await expect(page.locator('.gal-tool-content')).toContainText('手账已保存')
  await page.reload()
  await readSegment(page)
  await page.getByRole('button', { name: '手账', exact: true }).click()
  await expect(page.getByLabel('这段工作，让你想到了什么？')).toHaveValue('我的私人感受，不发送给任何角色。')
  const before = await snapshot(page)
  await request.get('http://127.0.0.1:3219/__fixture/fail-next')
  await page.locator('.gal-choice').first().click()
  await expect(page.locator('.gal-error')).toContainText('本回合未保存')
  expect((await snapshot(page)).revision).toBe(before.revision)
  await page.getByRole('button', { name: '查询并重试同一行动', exact: true }).click()
  await expect.poll(async () => (await snapshot(page)).revision).toBe(before.revision + 1)
  await expect(page.locator('.gal-error')).toHaveCount(0)
  await page.getByLabel('自动读对白').check()
  await page.waitForTimeout(7000)
  expect((await snapshot(page)).revision).toBe(before.revision + 1)
  await readSegment(page)
  await page.getByRole('button', { name: '记录', exact: true }).click()
  await page.getByRole('button', { name: '回到开场之前', exact: true }).click()
  await expect(page.getByRole('button', { name: /开始今天的工作/ })).toBeVisible()
  const fork = await snapshot(page)
  expect(fork.status).toBe('preparing')
  expect(fork.branches).toHaveLength(2)
  expect(fork.messages).toEqual([])
  await page.getByRole('button', { name: /开始今天的工作/ }).click()
  await expect.poll(async () => (await snapshot(page)).revision).toBe(1)
  await readSegment(page)
  await page.getByRole('button', { name: '保存并下班', exact: true }).click()
  await expect(page.locator('.gal-finish-panel')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})
