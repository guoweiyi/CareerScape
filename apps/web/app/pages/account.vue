<script setup lang="ts">
import { z } from 'zod'
import type { Identity } from '~/types/game'
const { identity, ensure, refresh, mutate } = useIdentity()
const tab = ref<'register' | 'login' | 'recover'>('register')
const accountTabs = [['register', '注册'], ['login', '登录'], ['recover', '找回密码']] as const
function selectTab(value: typeof tab.value) { tab.value = value; error.value = '' }
const form = reactive({ username: '', password: '', recoveryCode: '', claimGuest: false })
const schema = computed(() =>
  z.object({
    username: z.string().min(3, '至少3个字符').max(32),
    password: z.string().min(12, '密码至少12个字符').max(128),
    recoveryCode: tab.value === 'recover' ? z.string().min(8, '填写恢复码') : z.string(),
    claimGuest: z.boolean(),
  }),
)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const codes = ref<string[]>([])
const deleting = ref(false)
const deleteConfirm = ref('')
async function importArchive(event: Event) {
  const field = event.target as HTMLInputElement
  const file = field.files?.[0]
  if (!file) return
  error.value = ''
  busy.value = true
  try {
    if (file.size > 512000) throw new Error('存档超过首版512KB导入上限，请保留原导出文件。')
    const archive = JSON.parse(await file.text()) as Record<string, unknown>
    const result = await mutate<{ importedSessions: number }>('/api/account/import', archive)
    notice.value = `已导入 ${result.importedSessions} 条旅程副本，原存档保留。账号身份与权限不会从文件导入。`
  } catch (e) {
    error.value = getError(e)
  } finally {
    busy.value = false
    field.value = ''
  }
}
onMounted(() => {
  void ensure()
})
async function submit() {
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    if (tab.value === 'recover') {
      const result = await mutate<Identity>('/api/auth/recover', {
        username: form.username,
        recoveryCode: form.recoveryCode,
        newPassword: form.password,
      })
      identity.value = result
      await useDrafts().remove()
      notice.value = '密码已更新并登录，其他设备会话已撤销，已使用的恢复码失效。'
    } else {
      const result = await mutate<Identity & { recoveryCodes?: string[] }>(`/api/auth/${tab.value}`, {
        username: form.username,
        password: form.password,
        claimGuest: form.claimGuest,
      })
      identity.value = result
      codes.value = result.recoveryCodes || []
      notice.value = form.claimGuest ? '账号已就绪，游客旅程已按你的选择认领。' : '账号已就绪。'
      await useDrafts().remove()
    }
    form.password = ''
    form.recoveryCode = ''
  } catch (e) {
    error.value = getError(e)
  } finally {
    busy.value = false
  }
}
function getError(e: unknown) {
  const value = e as { data?: { message?: string; statusMessage?: string }; message?: string }
  return value.data?.message || value.data?.statusMessage || value.message || '操作暂未完成'
}
async function logout() {
  try {
    await mutate('/api/auth/logout')
    await useDrafts().remove()
    await refresh()
    codes.value = []
    notice.value = '已登出，此设备的会话已撤销。'
    await ensure()
  } catch (e) {
    error.value = getError(e)
  }
}
async function exportData() {
  try {
    const data = await $fetch('/api/account/export')
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'careerscape-my-data.json'
    link.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    error.value = getError(e)
  }
}
async function deleteAccount() {
  if (deleteConfirm.value !== '删除') return
  try {
    await mutate('/api/account', { confirm: 'DELETE' }, 'DELETE')
    await useDrafts().remove()
    await refresh()
    notice.value = '账号及关联旅程、私聊和手账已删除。'
    deleting.value = false
    codes.value = []
    await ensure()
  } catch (e) {
    error.value = getError(e)
  }
}
useHead({ title: '个人空间 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
<template>
  <main id="main" class="page-wrap">
    <p class="eyebrow">A SPACE OF YOUR OWN</p>
    <h1 class="page-title">把走过的路，留给自己。</h1>
    <p v-if="error" class="error-message" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <div v-if="codes.length" class="panel">
      <h2>请妥善保存一次性恢复码</h2>
      <p>忘记密码时用于恢复账号，仅此时显示。每个码只可使用一次，请保存在安全的密码管理器中。</p>
      <pre class="recovery-codes">{{ codes.join('\n') }}</pre>
      <button class="subtle-button" @click="codes = []">我已保存，隐藏恢复码</button>
    </div>
    <div class="split-panels">
      <section class="panel">
        <template v-if="!identity.user || identity.user.isGuest"
          ><div class="tabs" role="tablist" aria-label="账号操作">
            <button
              v-for="item in accountTabs"
              :key="item[0]"
              role="tab"
              :aria-selected="tab === item[0]"
              @click="selectTab(item[0])"
            >
              {{ item[1] }}
            </button>
          </div>
          <UForm :schema="schema" :state="form" class="form-stack" @submit="submit"
            ><UFormField label="用户名" name="username"
              ><UInput
                v-model="form.username"
                autocomplete="username"
                placeholder="3–32 个字符"
                class="w-full"
                size="lg" /></UFormField
            ><UFormField v-if="tab === 'recover'" label="一次性恢复码" name="recoveryCode"
              ><UInput v-model="form.recoveryCode" autocomplete="off" class="w-full" size="lg" /></UFormField
            ><UFormField :label="tab === 'recover' ? '新密码' : '密码'" name="password"
              ><UInput
                v-model="form.password"
                type="password"
                :autocomplete="tab === 'login' ? 'current-password' : 'new-password'"
                placeholder="至少 12 个字符"
                class="w-full"
                size="lg" /></UFormField
            ><label v-if="tab !== 'recover' && identity.user?.isGuest"
              ><input v-model="form.claimGuest" type="checkbox" />将当前游客身份的旅程认领到此账号</label
            >
            <p class="muted" style="font-size: 12px">
              不勾选时，游客旅程不会被转移。浏览器会切换到新登录的账号，请先按需导出游客数据。
            </p>
            <UButton type="submit" :loading="busy" size="lg" block>{{
              tab === 'register' ? '创建我的空间' : tab === 'login' ? '登录并继续' : '重设密码'
            }}</UButton></UForm
          ></template
        ><template v-else
          ><p class="eyebrow">你好，{{ identity.user.username }}</p>
          <h2>你的探索，由你保管。</h2>
          <p class="muted">已使用可撤销的设备会话登录。</p>
          <NuxtLink class="primary-button" to="/saves">回到我的旅程 ↗</NuxtLink
          ><button class="subtle-button" @click="logout">退出当前设备</button></template
        >
      </section>
      <section class="panel">
        <p class="eyebrow">PRIVACY BY DEFAULT</p>
        <h2>感受可以只属于你。</h2>
        <p class="muted">
          私人手账和 NPC 私聊默认仅本人可见。内容编辑、老师与客服不会因此获得阅读权限；对话不会默认用于训练。
        </p>
        <p class="muted">这里不输出职业适配百分比，也不从一次选择推断你的能力或人格。</p>
        <button class="secondary-button" @click="exportData">导出我的全部数据 ↓</button
        ><label class="secondary-button" style="margin-top: 14px; cursor: pointer"
          >导入自己的存档副本<input
            type="file"
            accept="application/json,.json"
            class="sr-only"
            :disabled="busy"
            @change="importArchive"
        /></label>
        <p class="muted" style="font-size: 12px; margin-top: 12px">
          仅支持本产品带校验清单的导出格式；最多512KB。导入会建立独立副本。
        </p>
        <div style="margin-top: 28px">
          <button class="danger-button" @click="deleting = !deleting">删除账号与关联数据</button>
          <div v-if="deleting" class="form-stack" style="margin-top: 16px">
            <p>将永久删除当前身份的旅程、对话、分支与手账。输入“删除”确认。</p>
            <label>确认文字<input v-model="deleteConfirm" autocomplete="off" /></label
            ><button class="danger-button" :disabled="deleteConfirm !== '删除'" @click="deleteAccount">
              确认删除
            </button>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
