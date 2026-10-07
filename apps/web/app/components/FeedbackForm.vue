<script setup lang="ts">
import { z } from 'zod'

const props = defineProps<{ sessionId?: string }>()
const emit = defineEmits<{ submitted: [] }>()
const { mutate } = useIdentity()
const kinds = [
  { label: '体验感受', value: 'experience' },
  { label: '内容问题', value: 'content_issue' },
  { label: '操作或显示问题', value: 'technical_issue' },
  { label: '其他建议', value: 'suggestion' },
]
const schema = z.object({
  kind: z.enum(['experience', 'content_issue', 'technical_issue', 'suggestion']),
  text: z.string().trim().min(1, '请写下想反馈的内容。').max(2000, '反馈最多2000字。'),
  consent: z.boolean().refine((value) => value, '请先确认自愿提交反馈。'),
})
const state = reactive<z.infer<typeof schema>>({ kind: 'experience', text: '', consent: false })
const busy = ref(false)
const error = ref('')
const notice = ref('')
async function submit() {
  if (busy.value) return
  const parsed = schema.safeParse(state)
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message || '请检查反馈内容。'
    return
  }
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await mutate('/api/feedback', {
      kind: parsed.data.kind,
      text: parsed.data.text,
      consent: true,
      ...(props.sessionId ? { sessionId: props.sessionId } : {}),
    })
    notice.value = '反馈已收到，谢谢你愿意分享。'
    state.text = ''
    state.consent = false
    emit('submitted')
  } catch (cause) {
    const value = cause as { data?: { message?: string; statusMessage?: string } }
    error.value =
      value.data?.message || value.data?.statusMessage || '反馈暂未发送成功，内容已保留，可以稍后重试。'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UForm :schema="schema" :state="state" class="form-stack" @submit="submit">
    <p class="muted">
      反馈完全自愿。内容团队只会看到你在这里主动填写的文字、类型和提交时间，不会收到你的对话或手账。
    </p>
    <p v-if="sessionId" class="muted">
      这条反馈会关联当前旅程，便于随该旅程管理和删除。不会附带旅程中的聊天内容。
    </p>
    <UFormField label="反馈类型" name="kind">
      <USelect v-model="state.kind" :items="kinds" class="w-full" size="lg" :disabled="busy" />
    </UFormField>
    <UFormField label="想和我们说的话" name="text" :description="`${state.text.length} / 2000 字`">
      <UTextarea
        v-model="state.text"
        :rows="5"
        :maxlength="2000"
        class="w-full"
        size="lg"
        :disabled="busy"
        placeholder="哪里让你有感触，或者哪里可以改进？"
      />
    </UFormField>
    <UFormField name="consent">
      <UCheckbox v-model="state.consent" :disabled="busy" label="我愿意将上面填写的内容发送给内容团队。" />
    </UFormField>
    <p v-if="error" role="alert" class="error-message">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <UButton type="submit" :loading="busy" :disabled="!state.consent || !state.text.trim()" size="lg"
      >发送这条反馈</UButton
    >
    <p class="muted feedback-footnote">
      可以只说一点，也可以随时离开。删除当前身份时，这条反馈也会一并删除。
    </p>
  </UForm>
</template>

<style scoped>
.feedback-footnote {
  font-size: 13px;
}
</style>
