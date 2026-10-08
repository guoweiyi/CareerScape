<script setup lang="ts">
import { ContentPackSchema, type ContentPack } from '../../../../packages/contracts'
import type { ContentBatch } from '../../../../packages/content/pipeline'
const { ensure, mutate } = useIdentity()
interface AdminPack {
  id: string
  version: number
  status: string
  active: boolean
  domainReviewStatus: string
  title: string
  manifest: ContentPack
}
interface AdminData {
  packs: AdminPack[]
  roles: string[]
  user: { id: string }
  stats: { sessions: number; contentTemplates: number }
  audit: { action: string; resourceId?: string; createdAt?: string }[]
  assetGate: { ok: boolean; errors: string[] }
  provider: { name: string; model: string; promptVersion: string }
}
const data = ref<AdminData | null>(null)
const selected = ref<AdminPack | null>(null)
const json = ref('')
const error = ref('')
const notice = ref('')
const reason = ref('')
const busy = ref(false)
const roleForm = reactive({ userId: '', role: 'editor', enabled: true })
const batches = ref<ContentBatch[]>([])
const batchId = ref('')
const tokenBudget = ref(12000)
const seed = ref('careerscape-preview-1')
const preview = ref('')
const batchBusy = ref(false)
const editorMode = ref<'graph' | 'json'>('graph')
const nodeDirty = ref(false)
const editorKey = ref(0)
const parsedPack = computed(() => {
  try {
    const parsed = ContentPackSchema.safeParse(JSON.parse(json.value))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
})
const draftDirty = computed(() => {
  if (!selected.value) return false
  try {
    return JSON.stringify(JSON.parse(json.value)) !== JSON.stringify(selected.value.manifest)
  } catch {
    return true
  }
})
const unsaved = computed(() => draftDirty.value || nodeDirty.value)
function confirmDiscard() {
  return !unsaved.value || window.confirm('有尚未保存的剧情修改。确定离开这些修改吗？')
}
function selectVersion(pack: AdminPack) {
  if (busy.value || (pack.id === selected.value?.id && pack.version === selected.value?.version)) return
  if (confirmDiscard()) select(pack)
}
function changeEditor(mode: 'graph' | 'json') {
  if (mode === editorMode.value) return
  if (nodeDirty.value && !window.confirm('这个节点还有尚未应用的修改。确定切换编辑方式吗？')) return
  nodeDirty.value = false
  editorMode.value = mode
  editorKey.value++
}
function updateGraph(pack: ContentPack) {
  json.value = JSON.stringify(pack, null, 2)
  notice.value = '节点已更新到本地草稿，请保存草稿后再检查或发布。'
}
async function loadBatches() {
  const result = await $fetch<{ batches: ContentBatch[] }>('/api/admin/batches')
  batches.value = result.batches
}
async function runBatch(action: 'plan' | 'generate' | 'resume' | 'validate', dryRun = false) {
  if (!selected.value) return
  batchBusy.value = true
  error.value = ''
  try {
    const result = await mutate<{ batch: ContentBatch; note?: string; estimatedTokens?: number }>(
      '/api/admin/batches',
      {
        action,
        packId: selected.value.id,
        version: selected.value.version,
        maxTokens: Number(tokenBudget.value),
        dryRun,
        ...(action !== 'plan' ? { batchId: batchId.value } : {}),
      },
    )
    if (!dryRun) {
      batchId.value = result.batch.id
      await loadBatches()
    }
    notice.value = dryRun
      ? `预计 ${result.estimatedTokens} tokens；mock费用0，尚未创建批次。`
      : result.note || '批次计划已保存，尚未生成。'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '批次操作失败'
  } finally {
    batchBusy.value = false
  }
}
async function previewSeed() {
  if (!selected.value) return
  if (unsaved.value) {
    error.value = '请先应用节点修改并保存草稿，再预览这个版本。'
    return
  }
  try {
    preview.value = JSON.stringify(
      await mutate('/api/admin/preview', {
        packId: selected.value.id,
        version: selected.value.version,
        seed: seed.value,
      }),
      null,
      2,
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : '预览失败'
  }
}
async function load() {
  data.value = await $fetch<AdminData>('/api/admin')
  if (!selected.value && data.value.packs[0]) select(data.value.packs[0])
}
function select(pack: AdminPack) {
  selected.value = pack
  json.value = JSON.stringify(pack.manifest, null, 2)
  notice.value = ''
  nodeDirty.value = false
  editorKey.value++
  preview.value = ''
  batchId.value = ''
}
async function action(kind: string) {
  if (!selected.value) return
  if (nodeDirty.value) {
    error.value = '请先应用或撤销当前节点表单的修改。'
    return
  }
  if (draftDirty.value && kind !== 'save') {
    error.value = '请先保存草稿，再执行检查、审核或版本操作。'
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    const pack = kind === 'save' ? ContentPackSchema.parse(JSON.parse(json.value)) : undefined
    await mutate('/api/admin/content', {
      action: kind,
      packId: selected.value.id,
      version: selected.value.version,
      reason: reason.value || '合成演示内容审核',
      ...(pack ? { pack } : {}),
    })
    const version = selected.value.version,
      packId = selected.value.id
    selected.value = null
    await load()
    const packs = data.value?.packs ?? []
    const refreshed = packs.find(
      (p) =>
        p.id === packId &&
        p.version ===
          (kind === 'clone'
            ? Math.max(...packs.filter((p) => p.id === packId).map((p) => p.version))
            : version),
    )
    if (refreshed) select(refreshed)
    notice.value = '操作已保存并记录审计。'
  } catch (e) {
    error.value = e instanceof Error ? e.message : '操作未完成'
  } finally {
    busy.value = false
  }
}
function validateLocal() {
  const result = ContentPackSchema.safeParse(
    (() => {
      try {
        return JSON.parse(json.value)
      } catch {
        return null
      }
    })(),
  )
  notice.value = result.success
    ? '字段 schema 通过。图与逻辑引用由自动检查验证；实际资源文件由发布门禁核验。'
    : ''
  error.value = result.success
    ? ''
    : result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('\n')
}
async function updateRole() {
  try {
    await mutate('/api/admin/roles', roleForm)
    notice.value = '角色授权已更新并审计。'
    await load()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '授权失败'
  }
}
onMounted(async () => {
  window.addEventListener('beforeunload', beforeUnload)
  try {
    await ensure()
    await load()
    await loadBatches()
  } catch {
    error.value = '当前账号没有内容工作台权限。请由实例管理员在服务器授予编辑/审核/管理员角色。'
  }
})
function beforeUnload(event: BeforeUnloadEvent) {
  if (unsaved.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onBeforeUnmount(() => window.removeEventListener('beforeunload', beforeUnload))
onBeforeRouteLeave(() => confirmDiscard())
useHead({ title: '内容工作台 · 职境漫游', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
<template>
  <main id="main" class="page-wrap" style="max-width: 1280px">
    <p class="eyebrow">CONTENT STUDIO</p>
    <h1 class="page-title">让每一个故事，有据可查。</h1>
    <p class="muted">内容编辑与玩家私密数据分离。角色、项目、事件、来源和作者图以受校验结构编辑。</p>
    <p v-if="error" class="error-message" role="alert" style="white-space: pre-wrap">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <template v-if="data"
      ><div class="notice">
        {{ data.stats.contentTemplates }} 个内容模板 · {{ data.stats.sessions }} 个会话（仅数量） ·
        Provider：{{ data.provider.name }} · Prompt：{{ data.provider.promptVersion }} · 资源门禁：{{
          data.assetGate.ok ? '通过' : '未通过'
        }}
        <p v-for="item in data.assetGate.errors" :key="item">{{ item }}</p>
      </div>
      <div class="admin-layout">
        <aside class="admin-list" aria-label="内容包版本">
          <button
            v-for="pack in data.packs"
            :key="`${pack.id}-${pack.version}`"
            :aria-pressed="selected?.id === pack.id && selected?.version === pack.version"
            :disabled="busy"
            @click="selectVersion(pack)"
          >
            {{ pack.title
            }}<small>v{{ pack.version }} · {{ pack.status }} {{ pack.active ? '· 新局入口' : '' }}</small
            ><small>行业审核：{{ pack.domainReviewStatus }}</small>
          </button>
        </aside>
        <section v-if="selected" class="panel">
          <h2>{{ selected.title }} / v{{ selected.version }}</h2>
          <p class="muted">发布版本不可原地覆盖。需要修改时先复制为新草稿；回退只改变新局入口。</p>
          <div class="tabs" role="tablist" aria-label="剧情编辑方式">
            <button role="tab" :aria-selected="editorMode === 'graph'" @click="changeEditor('graph')">
              节点视图
            </button>
            <button role="tab" :aria-selected="editorMode === 'json'" @click="changeEditor('json')">
              高级 JSON
            </button>
          </div>
          <p v-if="unsaved" class="notice" role="status">
            {{ nodeDirty ? '当前节点有尚未应用的修改。' : '草稿已修改，尚未保存到服务器。' }}
          </p>
          <ContentGraphEditor
            v-if="editorMode === 'graph' && parsedPack"
            :key="editorKey"
            :model-value="parsedPack"
            :readonly="selected.status !== 'draft' || busy"
            @update:model-value="updateGraph"
            @dirty-change="nodeDirty = $event"
          />
          <p v-else-if="editorMode === 'graph'" class="error-message" role="alert">
            当前 JSON 不符合内容包格式。请在“高级 JSON”修正，再进入节点视图。
          </p>
          <label v-if="editorMode === 'json'" for="pack-json" class="sr-only">内容包 JSON 编辑器</label>
          <textarea
            v-if="editorMode === 'json'"
            id="pack-json"
            v-model="json"
            class="admin-json"
            spellcheck="false"
            :readonly="selected.status !== 'draft' || busy"
          />
          <div class="form-stack" style="margin-top: 16px">
            <label
              >操作原因<input v-model="reason" maxlength="500" placeholder="审核意见、发布说明或回退原因"
            /></label>
          </div>
          <div class="admin-actions">
            <button class="secondary-button" @click="validateLocal">检查字段</button
            ><button class="secondary-button" :disabled="busy" @click="action('clone')">复制为草稿</button
            ><button
              class="secondary-button"
              :disabled="busy || selected.status !== 'draft'"
              @click="action('save')"
            >
              保存草稿</button
            ><button class="secondary-button" :disabled="busy" @click="action('check')">自动检查</button
            ><button
              v-if="data.roles.includes('reviewer') || data.roles.includes('admin')"
              class="secondary-button"
              :disabled="busy"
              @click="action('approve')"
            >
              审核通过</button
            ><button
              v-if="data.roles.includes('admin')"
              class="primary-button"
              :disabled="busy"
              @click="action('publish')"
            >
              发布新版本</button
            ><button
              v-if="data.roles.includes('admin') && selected.status === 'published'"
              class="secondary-button"
              :disabled="busy"
              @click="action('rollback')"
            >
              回退入口至此版本
            </button>
          </div>
        </section>
      </div>
      <section class="panel" style="margin-top: 24px">
        <h2>按 seed 预览组局</h2>
        <p class="muted">使用当前选中的内容版本，仅预览映射和可用行动，不创建玩家存档。</p>
        <form class="form-stack" @submit.prevent="previewSeed">
          <label>抽样 seed<input v-model="seed" maxlength="80" required /></label
          ><button class="secondary-button" type="submit">查看这个组合</button>
        </form>
        <pre v-if="preview" class="json-output">{{ preview }}</pre>
      </section>
      <section class="panel" style="margin-top: 24px">
        <h2>离线候选与批次预算</h2>
        <p class="muted">
          当前仅运行明确标记的 mock 管线，不调用付费模型。先计划，再生成、校验；发布仍由内容包门禁决定。
        </p>
        <div class="form-stack">
          <label
            >Token预算（0可演示自动暂停）<input v-model="tokenBudget" type="number" min="0" max="50000"
          /></label>
        </div>
        <div class="admin-actions">
          <button class="secondary-button" :disabled="batchBusy" @click="runBatch('plan', true)">
            预估 · Dry run</button
          ><button class="secondary-button" :disabled="batchBusy" @click="runBatch('plan')">
            创建/读取计划</button
          ><button class="secondary-button" :disabled="batchBusy || !batchId" @click="runBatch('generate')">
            生成候选</button
          ><button class="secondary-button" :disabled="batchBusy || !batchId" @click="runBatch('resume')">
            按预算续跑</button
          ><button class="secondary-button" :disabled="batchBusy || !batchId" @click="runBatch('validate')">
            校验候选
          </button>
        </div>
        <article v-for="batch in batches" :key="batch.id" class="batch-item">
          <button class="subtle-button" :aria-pressed="batchId === batch.id" @click="batchId = batch.id">
            {{ batchId === batch.id ? '已选中' : '选择批次' }} · {{ batch.id }}
          </button>
          <p>
            状态 {{ batch.status }} · 游标 {{ batch.cursor }} / {{ batch.items.length }} · 预算
            {{ batch.budget.usedTokens }} / {{ batch.budget.maxTokens }} tokens
          </p>
          <details>
            <summary>查看逐项候选、尝试次数与校验结果</summary>
            <pre class="json-output">{{ JSON.stringify(batch.items, null, 2) }}</pre>
          </details>
        </article>
      </section>
      <section v-if="data.roles.includes('admin')" class="panel" style="margin-top: 24px">
        <h2>基础角色授权</h2>
        <form class="form-stack" @submit.prevent="updateRole">
          <label>用户 ID<input v-model="roleForm.userId" required /></label
          ><label
            >角色<select v-model="roleForm.role">
              <option>editor</option>
              <option>reviewer</option>
              <option>admin</option>
            </select></label
          ><label><input v-model="roleForm.enabled" type="checkbox" />授予（取消勾选为撤销）</label
          ><button class="secondary-button" type="submit">保存授权</button>
        </form>
      </section>
      <AdminFeedback />
      <section class="panel audit-list">
        <h2>最近审计（仅元信息）</h2>
        <ul>
          <li v-for="(entry, index) in data.audit" :key="index">
            {{ entry.action }} · {{ entry.resourceId }} · {{ entry.createdAt }}
          </li>
        </ul>
      </section></template
    ><NuxtLink v-else class="secondary-button" to="/account">前往账号空间 ↗</NuxtLink>
  </main>
</template>
