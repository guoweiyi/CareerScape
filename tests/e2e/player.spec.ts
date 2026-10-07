import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import Database from 'better-sqlite3'

test('手机：实际点击走完三条路线，保存、私聊、手账、回溯及图片失败降级', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('再想象')
  await expect(page.locator('.hero-character img')).toBeVisible()
  await page.getByRole('button', { name: '开启第一段职境' }).click()
  await expect(page).toHaveURL(/\/play\//)
  await expect(page.locator('.save-status')).toContainText('已保存')
  const gameUrl = page.url()
  await mkdir('docs/screenshots', { recursive: true })
  await page.screenshot({ path: 'docs/screenshots/play-390.png' })
  await page.screenshot({ path: 'docs/screenshots/play-390-full.png', fullPage: true })
  await expect(page.locator('.provider-badge')).toContainText('模拟对话')
  await page.getByLabel('发给').selectOption('zhou')
  await page.getByLabel('你的消息').fill('我想先确认复现步骤，能一起看吗？')
  await page.getByRole('button', { name: '发送 ↑' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('我想先确认复现步骤')
  await page.screenshot({ path: 'docs/screenshots/chat-390.png' })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.getByRole('button', { name: '手账', exact: true }).click()
  await page.getByLabel('手账内容').fill('我的私人感受：还想了解验证过程。')
  await page.getByRole('button', { name: '保存这一页' }).click()
  await expect(page.getByRole('dialog')).toContainText('已保存，仅你可见')
  await page.screenshot({ path: 'docs/screenshots/journal-390.png' })
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.reload()
  await expect(page.locator('.save-status')).toContainText('已保存')
  await page.getByRole('button', { name: '手账', exact: true }).click()
  await expect(page.getByLabel('手账内容')).toHaveValue('我的私人感受：还想了解验证过程。')
  await page.getByRole('button', { name: '关闭面板' }).click()
  await context.setOffline(true)
  await page.getByLabel('你的消息').fill('离线草稿应当保留')
  await expect(page.getByRole('button', { name: '发送 ↑' })).toBeDisabled()
  await context.setOffline(false)
  await expect(page.getByRole('button', { name: '发送 ↑' })).toBeEnabled()
  await page.getByLabel('你的消息').fill('')
  const paths = [
    [
      '先了解今天要交付什么',
      '把成功条件写成一张检查卡',
      '和周砚一起复现，再验证修复',
      '检查修复：正常点击与连续点击都只保留一条',
      '提交已验证清单，正常下班',
    ],
    [
      '我没做过测试，能带我开始吗',
      '请许知确认重复报名的影响',
      '请许知协商本次先不开放报名',
      '确认缩小范围，并检查关闭入口后的提示',
      '确认缩小范围，留下后续待办',
    ],
    [
      '先了解今天要交付什么',
      '请林澄演示一遍正常流程',
      '今天先不继续排查，整理交接',
      '记录尚未验证，把问题和下一步交出去',
      '交接未完成事项，结束今天体验',
    ],
  ]
  for (let index = 0; index < paths.length; index++) {
    if (index) {
      await page.goto('/')
      await page.getByRole('button', { name: '开启第一段职境' }).click()
      await expect(page).toHaveURL(/\/play\//)
    }
    for (const label of paths[index]!) {
      await page
        .getByRole('button', { name: new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
        .click()
      await expect(page.locator('.save-status')).toContainText('已保存')
    }
    await expect(page.getByRole('heading', { name: '今天的故事，先停在这里。' })).toBeVisible()
  }
  await page.goto(gameUrl)
  await page.getByRole('button', { name: '对话', exact: true }).click()
  await page.getByRole('button', { name: '从这里另开一条路线' }).first().click()
  await expect(page.locator('.save-status')).toContainText('已创建新分支')
  await page.getByRole('button', { name: '路线与存档', exact: true }).click()
  await expect(page.locator('.branch-item')).toHaveCount(2)
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.route('**/art/*.webp', (route) => route.abort())
  await page.reload()
  await expect(page.locator('.dialogue-text')).not.toBeEmpty()
  await page.getByRole('button', { name: '交接下班 ↗' }).click()
  await expect(page.getByRole('heading', { name: '今天的故事，先停在这里。' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(errors).toEqual([])
})

test('桌面：注册认领、恢复码登录、导出导入及账号删除', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.screenshot({ path: 'docs/screenshots/home-1440.png', fullPage: true })
  await page.getByRole('button', { name: '开启第一段职境' }).click()
  await expect(page).toHaveURL(/\/play\//)
  await expect(page.locator('.save-status')).toContainText('已保存')
  await page.screenshot({ path: 'docs/screenshots/play-1440.png' })
  await page.screenshot({ path: 'docs/screenshots/play-1440-full.png', fullPage: true })
  await page.goto('/account')
  const username = `test_${Date.now()}`
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill('test-passphrase-2026-safe')
  await page.getByLabel('将当前游客身份的旅程认领到此账号').check()
  await page.getByRole('button', { name: '创建我的空间' }).click()
  await expect(page.getByRole('heading', { name: '请妥善保存一次性恢复码' })).toBeVisible()
  const recoveryCode = (await page.locator('.recovery-codes').innerText()).split('\n')[0]!
  await page.getByRole('button', { name: '我已保存，隐藏恢复码' }).click()
  await page.goto('/saves')
  await expect(page.locator('.save-item')).toHaveCount(1)
  await page.screenshot({ path: 'docs/screenshots/saves-1440.png', fullPage: true })
  await page.goto('/account')
  await page.getByRole('button', { name: '退出当前设备' }).click()
  await page.getByRole('tab', { name: '找回密码' }).click()
  await page.getByLabel('用户名', { exact: true }).fill(username)
  await page.getByLabel('一次性恢复码', { exact: true }).fill(recoveryCode)
  await page.getByLabel('新密码', { exact: true }).fill('new-test-passphrase-2026-safe')
  await page.getByRole('button', { name: '重设密码' }).click()
  await expect(page.getByRole('status')).toContainText('密码已更新并登录')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出我的全部数据' }).click()
  const archive = await download
  expect(archive.suggestedFilename()).toBe('careerscape-my-data.json')
  await page.locator('input[type=file]').setInputFiles((await archive.path())!)
  await expect(page.getByRole('status')).toContainText('已导入 1 条旅程副本')
  await page.goto('/saves')
  await expect(page.locator('.save-item')).toHaveCount(2)
  await page.goto('/account')
  await page.getByRole('button', { name: '删除账号与关联数据' }).click()
  await page.getByLabel('确认文字').fill('删除')
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('已删除')
})

test('工作台：拒绝普通账号、预算暂停续跑、草稿审核发布与旧版本回退', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/account')
  await page.getByLabel('用户名', { exact: true }).fill(`editor_${Date.now()}`)
  await page.getByLabel('密码', { exact: true }).fill('content-studio-passphrase-2026')
  await page.getByRole('button', { name: '创建我的空间' }).click()
  await expect(page.getByRole('heading', { name: '请妥善保存一次性恢复码' })).toBeVisible()
  await page.getByRole('button', { name: '我已保存，隐藏恢复码' }).click()
  expect((await page.request.get('/api/admin')).status()).toBe(403)
  const identity = await (await page.request.get('/api/me')).json()
  // Test fixture performs the same local-operator grant as scripts/db.ts bootstrap-admin.
  const database = new Database(process.env.E2E_DATABASE_PATH!)
  try {
    for (const role of ['editor', 'reviewer', 'admin'])
      database.prepare('INSERT OR IGNORE INTO user_roles VALUES (?,?)').run(identity.user.id, role)
  } finally {
    database.close()
  }
  await page.goto('/feedback')
  await page.getByLabel('想和我们说的话', { exact: true }).fill('公开测试反馈：希望有更多真实职责场景。')
  await expect(page.getByRole('button', { name: '发送这条反馈' })).toBeDisabled()
  await page.getByLabel('我愿意将上面填写的内容发送给内容团队。').check()
  await page.getByRole('button', { name: '发送这条反馈' }).click()
  await expect(page.getByRole('status')).toContainText('反馈已收到')
  await page.goto('/admin')
  await expect(page.getByText('公开测试反馈：希望有更多真实职责场景。', { exact: true })).toBeVisible()
  await expect(page.locator('.admin-list')).toContainText('v2')
  await page.getByRole('button', { name: '查看这个组合' }).click()
  await expect(page.locator('pre.json-output').first()).toContainText('"previewOnly": true')
  await page.getByLabel('Token预算（0可演示自动暂停）').fill('0')
  await page.getByRole('button', { name: '预估 · Dry run' }).click()
  await expect(page.getByRole('status')).toContainText('mock费用0')
  await page.getByRole('button', { name: '创建/读取计划' }).click()
  await expect(page.locator('.batch-item')).toHaveCount(1)
  await page.getByRole('button', { name: '生成候选', exact: true }).click()
  await expect(page.locator('.batch-item')).toContainText('paused')
  await page.getByLabel('Token预算（0可演示自动暂停）').fill('12000')
  await page.getByRole('button', { name: '按预算续跑' }).click()
  await expect(page.locator('.batch-item')).toContainText('14 / 14')
  await page.getByRole('button', { name: '校验候选' }).click()
  await expect(page.locator('.batch-item')).toContainText('completed')
  await page.getByRole('button', { name: '复制为草稿' }).click()
  await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('v3')
  await page.getByLabel('操作原因').fill('自动化验收：合成演示包，仅执行编辑审核，不声明行业事实已审核')
  await page.getByRole('button', { name: '保存草稿' }).click()
  await expect(page.getByRole('status')).toContainText('操作已保存')
  await page.getByRole('button', { name: '自动检查', exact: true }).click()
  await expect(page.locator('.admin-list button[aria-pressed=true]')).toContainText('auto_checked')
  await page.getByRole('button', { name: '审核通过' }).click()
  await expect(page.locator('.admin-list button[aria-pressed=true]')).toContainText('approved')
  await page.getByRole('button', { name: '发布新版本' }).click()
  await expect(page.locator('.admin-list button[aria-pressed=true]')).toContainText('新局入口')
  await page.screenshot({ path: 'docs/screenshots/admin-1440.png' })
  await page.locator('.admin-list button').filter({ hasText: 'v2 ·' }).click()
  await page.getByRole('button', { name: '回退入口至此版本' }).click()
  await expect(page.locator('.admin-list button[aria-pressed=true]')).toContainText('新局入口')
  const catalog = await (await page.request.get('/api/catalog')).json()
  expect(catalog.occupations.find((item: { status: string }) => item.status === 'playable').packVersion).toBe(
    2,
  )
  await expect(page.locator('.audit-list')).toContainText('qa-last-hour')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('360窄屏、200%字号与减少动态可操作，私有页不共享缓存', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.getByRole('button', { name: '开启第一段职境' }).click()
  await expect(page).toHaveURL(/\/play\//)
  await page.addStyleTag({
    content:
      'html { font-size: 200% !important; } .dialogue-text,.choice-button strong { font-size: 200% !important; }',
  })
  await expect(page.getByRole('button', { name: /先了解今天要交付什么/ })).toBeVisible()
  await page.getByRole('button', { name: /先了解今天要交付什么/ }).click()
  await expect(page.locator('.save-status')).toContainText('已保存')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  const response = await page.request.get('/api/me')
  expect(response.headers()['cache-control']).toContain('no-store')
  const denied = await page.request.post('/api/sessions', {
    data: { packId: 'qa-last-hour' },
    headers: { Origin: 'https://evil.invalid' },
  })
  expect(denied.status()).toBe(403)
})

test('提交响应丢失后自动查回同一回合，低流量与纯文字仍可下班', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '开启第一段职境' }).click()
  await expect(page).toHaveURL(/\/play\//)
  const sessionId = page.url().split('/').at(-1)!
  const before = await (await page.request.get(`/api/sessions/${sessionId}`)).json()
  let actionId = ''
  await page.route(
    '**/api/sessions/*/action',
    async (route) => {
      actionId = route.request().postDataJSON().clientActionId
      await route.fetch()
      await route.abort('failed')
    },
    { times: 1 },
  )
  await page.getByRole('button', { name: /先了解今天要交付什么/ }).click()
  await expect(page.locator('.save-status')).toContainText('已恢复服务器确认的结果')
  const after = await (await page.request.get(`/api/sessions/${sessionId}`)).json()
  expect(after.revision).toBe(before.revision + 1)
  const receipt = await (
    await page.request.get(`/api/sessions/${sessionId}/turn?clientActionId=${actionId}`)
  ).json()
  expect(receipt.status).toBe('committed')
  await page.reload()
  await expect(page.locator('.save-status')).toContainText(`修订 ${after.revision}`)
  await expect(page.locator('.scene-background img')).toHaveCount(1)
  await page.getByRole('button', { name: '体验设置', exact: true }).click()
  await page.getByLabel('低流量模式').check()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await expect(page.locator('.scene-background img')).toHaveCount(0)
  await page.getByRole('button', { name: '体验设置', exact: true }).click()
  await page.getByLabel('纯文字模式').check()
  await page.getByRole('button', { name: '关闭面板' }).click()
  await page.setViewportSize({ width: 844, height: 390 })
  await page.getByRole('button', { name: '交接下班 ↗' }).click()
  await expect(page.getByRole('heading', { name: '今天的故事，先停在这里。' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
})
