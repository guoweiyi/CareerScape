import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

test('结局回顾：仅已提交结局解锁，回溯保留记录，链接准确读取原分支', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/endings')
  await expect(page.getByRole('heading', { name: '先让一个故事开始。' })).toBeVisible()
  await page.getByRole('link', { name: '走进一段职境 ↗' }).click()
  await page.getByRole('button', { name: '开启第一段职境' }).click()
  await expect(page.locator('.save-status')).toContainText('已保存')
  const sessionPath = new URL(page.url()).pathname
  await page.goto('/endings')
  await expect(page.getByTestId('unlocked-ending')).toHaveCount(0)
  await expect(page.getByTestId('locked-ending')).toHaveCount(3)
  await page.goto(sessionPath)
  await page.getByRole('button', { name: '交接下班 ↗' }).click()
  await expect(page.getByRole('heading', { name: '今天的故事，先停在这里。' })).toBeVisible()
  const original = await (await page.request.get(`/api/sessions/${sessionPath.split('/').at(-1)}`)).json()
  await page.getByRole('link', { name: '看看走过的结局 ↗' }).click()
  await expect(page.getByTestId('unlocked-ending')).toHaveCount(1)
  await expect(page.getByTestId('locked-ending')).toHaveCount(2)
  await mkdir('test-results/screenshots', { recursive: true })
  await page.screenshot({ path: 'test-results/screenshots/endings-390.png', fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.screenshot({ path: 'test-results/screenshots/endings-1440.png' })
  await page.getByRole('link', { name: '回看这条路线 ↗' }).click()
  await expect(page).toHaveURL(new RegExp(`branchId=${original.branchId}`))
  await expect(page.getByRole('heading', { name: '今天的故事，先停在这里。' })).toBeVisible()
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await page.getByRole('button', { name: '从这里另开一条路线' }).first().click()
  await expect(page.locator('.save-status')).toContainText('已创建新分支')
  await expect(page.getByRole('button', { name: /先了解今天要交付什么/ })).toBeVisible()
  const newBranchUrl = page.url()
  await page.reload()
  await expect(page).toHaveURL(newBranchUrl)
  await expect(page.getByRole('button', { name: /先了解今天要交付什么/ })).toBeVisible()
  const newBranchId = new URL(newBranchUrl).searchParams.get('branchId')!
  let interruptedActionId = ''
  await page.route('**/api/sessions/*/turn?**', (route) => route.abort('failed'))
  await page.route(
    '**/api/sessions/*/action',
    async (route) => {
      interruptedActionId = route.request().postDataJSON().clientActionId
      await route.fetch()
      await route.abort('failed')
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: /先了解今天要交付什么/ }).click()
  await expect(page.locator('.save-status')).toContainText('上次操作待确认')
  const identity = await (await page.request.get('/api/me')).json()
  const persistedActionId = await page.evaluate(
    async (key) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('careerscape-drafts', 1)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        return await new Promise<string | undefined>((resolve, reject) => {
          const request = database.transaction('drafts').objectStore('drafts').get(key)
          request.onsuccess = () => resolve(request.result?.value?.pending?.clientActionId)
          request.onerror = () => reject(request.error)
        })
      } finally {
        database.close()
      }
    },
    `${identity.user.id}:${sessionPath.split('/').at(-1)}`,
  )
  expect(persistedActionId).toBe(interruptedActionId)
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await expect(page.getByRole('button', { name: '从这里另开一条路线' }).first()).toBeDisabled()
  await page.goto('/endings')
  await expect(page.getByTestId('unlocked-ending')).toHaveCount(1)
  await page.getByRole('link', { name: '回看这条路线 ↗' }).click()
  await expect(page).toHaveURL(new RegExp(`branchId=${original.branchId}`))
  await expect(page.getByRole('heading', { name: '今天的故事，先停在这里。' })).toBeVisible()
  await expect(
    page.getByText('另一条路线有尚未确认的行动。当前仍显示你选择的路线，原动作编号已保留。'),
  ).toBeVisible()
  await page.unroute('**/api/sessions/*/turn?**')
  await page.getByRole('button', { name: '前往原路线核对' }).click()
  await expect(page).toHaveURL(new RegExp(`branchId=${newBranchId}`))
  await expect(page.locator('.save-status')).toContainText('已恢复服务器确认的结果')
  const receipt = await (
    await page.request.get(
      `/api/sessions/${sessionPath.split('/').at(-1)}/turn?clientActionId=${interruptedActionId}`,
    )
  ).json()
  expect(receipt.status).toBe('committed')
  expect(receipt.session.branchId).toBe(newBranchId)
  const response = await page.request.get('/api/account/endings')
  expect(response.headers()['cache-control']).toContain('no-store')
})
