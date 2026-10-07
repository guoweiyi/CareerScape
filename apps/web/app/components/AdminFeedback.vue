<script setup lang="ts">
type Feedback = {
  kind: 'experience' | 'content_issue' | 'technical_issue' | 'suggestion'
  text: string
  createdAt: string
}
const labels: Record<Feedback['kind'], string> = {
  experience: '体验感受',
  content_issue: '内容问题',
  technical_issue: '操作或显示问题',
  suggestion: '其他建议',
}
const items = ref<Feedback[]>([])
const busy = ref(false)
const loaded = ref(false)
const error = ref('')
async function load() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await $fetch<{ items: Feedback[]; limit: number }>('/api/admin/feedback')
    items.value = response.items
    loaded.value = true
  } catch (cause) {
    items.value = []
    const value = cause as { data?: { message?: string } }
    error.value = value.data?.message || '反馈暂时无法读取，请确认内容工作台权限后重试。'
  } finally {
    busy.value = false
  }
}
onMounted(() => {
  void load()
})
</script>

<template>
  <section class="panel" aria-labelledby="feedback-heading" :aria-busy="busy">
    <div class="feedback-heading">
      <h2 id="feedback-heading">自愿反馈</h2>
      <button class="subtle-button" :disabled="busy" @click="load">
        {{ busy ? '正在读取…' : '刷新反馈' }}
      </button>
    </div>
    <p class="muted">只展示最近100条记录中有明确提交同意的反馈。这里不提供账号信息、私聊、手账或完整旅程。</p>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <p v-else-if="loaded && !items.length" role="status" class="muted">还没有主动提交的反馈。</p>
    <ol v-if="items.length" class="feedback-list">
      <li v-for="(item, index) in items" :key="`${item.createdAt}-${index}`">
        <div class="feedback-meta">
          <strong>{{ labels[item.kind] }}</strong
          ><time :datetime="item.createdAt">{{ new Date(item.createdAt).toLocaleString('zh-CN') }}</time>
        </div>
        <p class="feedback-text">{{ item.text }}</p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.feedback-heading,
.feedback-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.feedback-list {
  list-style: none;
  padding: 0;
  margin-top: 20px;
}
.feedback-list li {
  border-top: 1px solid #d8dfd2;
  padding: 20px 0;
}
.feedback-meta time {
  color: #5c6962;
  font-size: 13px;
}
.feedback-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
