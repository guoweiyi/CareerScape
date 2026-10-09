import { JsonlParser } from '../../../../packages/contracts/protocol'
import {
  GalgameActionSchema,
  GalgameSessionDTOSchema,
  type GalgameAction,
  type GalgameSessionDTO,
} from '../../../../packages/contracts/galgame'

export function useGalgameSession(sessionId: string) {
  const { identity, ensure, mutate } = useIdentity(),
    drafts = useDrafts(),
    route = useRoute()
  const session = shallowRef<GalgameSessionDTO | null>(null),
    busy = ref(false),
    error = ref(''),
    progress = ref('正在读取故事…')
  const pending = shallowRef<GalgameAction | null>(null)
  let controller: AbortController | undefined,
    stopped = false
  const draftKey = () => `galgame:${identity.value.user?.id}:${sessionId}:pending`
  const validUser = (userId: string | undefined) =>
    !stopped && Boolean(userId && identity.value.user?.id === userId)
  const errorText = (error: unknown) => {
    const e = error as { data?: { message?: string }; message?: string }
    return e.data?.message || e.message || '这段故事暂时无法读取，请稍后重试。'
  }
  async function read(branchId?: string) {
    const userId = identity.value.user?.id
    const data = await $fetch(`/api/sessions/${sessionId}`, { query: branchId ? { branchId } : {} })
    if (!validUser(userId)) return
    session.value = GalgameSessionDTOSchema.parse(data)
  }
  async function clearPending() {
    pending.value = null
    await drafts.remove(draftKey()).catch(() => undefined)
  }
  async function recover(action: GalgameAction, wait = true) {
    const userId = identity.value.user?.id
    for (let count = 0; count < (wait ? 27 : 1); count++) {
      if (!validUser(userId)) return false
      const turn = await $fetch<{ status: string; session?: unknown }>(`/api/sessions/${sessionId}/turn`, {
        query: { clientActionId: action.clientActionId },
      })
      if (!validUser(userId)) return false
      if (turn.status === 'committed') {
        await read(action.branchId)
        await clearPending()
        return true
      }
      if (turn.status !== 'running') return false
      progress.value = '同事还在回应，正在找回这一段故事…'
      if (wait) await new Promise((resolve) => setTimeout(resolve, 3000))
    }
    return false
  }
  async function send(action: GalgameAction) {
    if (busy.value || stopped) return
    busy.value = true
    error.value = ''
    progress.value = '正在接住你的行动…'
    pending.value = action
    const userId = identity.value.user?.id
    controller = new AbortController()
    await drafts.put(draftKey(), action).catch(() => undefined)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': identity.value.csrfToken || '' },
        body: JSON.stringify(action),
        signal: controller.signal,
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string }
        throw new Error(data.message || '行动暂未提交，请查询后重试。')
      }
      if (!response.body) throw new Error('回复中断，正在找回已保存的故事。')
      const reader = response.body.getReader(),
        parser = new JsonlParser()
      let committed = false,
        failure = ''
      try {
        while (true) {
          const result = await reader.read()
          if (result.done) break
          for (const frame of parser.push(result.value)) {
            if (frame.sessionId !== sessionId || frame.branchId !== action.branchId)
              throw new Error('回复属于其他路线，请重新读取。')
            if (!validUser(userId)) return
            if (frame.type === 'tool_status') progress.value = frame.payload.label
            if (frame.type === 'turn_failed') failure = frame.payload.message
            if (frame.type === 'turn_committed') {
              const dto = GalgameSessionDTOSchema.parse(frame.payload.session)
              if (
                dto.id !== sessionId ||
                dto.branchId !== action.branchId ||
                dto.revision !== frame.payload.revision
              )
                throw new Error('保存记录未能对齐，请重新读取。')
              session.value = dto
              committed = true
            }
          }
        }
        parser.finish()
      } finally {
        reader.releaseLock()
      }
      if (!committed) throw new Error(failure || '这次回应未保存，可以重试同一行动。')
      await read(action.branchId)
      await clearPending()
    } catch (cause) {
      if (validUser(userId)) {
        try {
          if (await recover(action)) return
        } catch {
          /* Keep the durable pending action for a later query. */
        }
        if (validUser(userId)) error.value = errorText(cause)
      }
    } finally {
      if (validUser(userId)) {
        busy.value = false
        progress.value = ''
      }
    }
  }
  async function act(
    input: Omit<GalgameAction, 'clientActionId' | 'branchId' | 'expectedRevision' | 'channel'> & {
      channel?: 'group' | 'private'
    },
  ) {
    if (!session.value || pending.value) return
    await send({
      channel: 'group',
      ...input,
      clientActionId: input.kind === 'begin' ? session.value.beginActionId : crypto.randomUUID(),
      branchId: session.value.branchId,
      expectedRevision: session.value.revision,
    })
  }
  async function retry() {
    if (pending.value) await send(pending.value)
  }
  async function discard() {
    if (!pending.value || busy.value) return
    busy.value = true
    error.value = ''
    try {
      if (await recover(pending.value, false)) return
      const turn = await $fetch<{ status: string }>(`/api/sessions/${sessionId}/turn`, {
        query: { clientActionId: pending.value.clientActionId },
      })
      if (turn.status === 'running') throw new Error('这次回应仍在生成，请稍后查询。')
      await read(pending.value.branchId)
      await clearPending()
    } catch (cause) {
      error.value = errorText(cause)
    } finally {
      busy.value = false
    }
  }
  async function switchBranch(branchId: string) {
    if (busy.value || pending.value) return
    busy.value = true
    error.value = ''
    try {
      await read(branchId)
    } catch (cause) {
      error.value = errorText(cause)
    } finally {
      busy.value = false
    }
  }
  async function fork(eventSeq: number) {
    if (!session.value || busy.value || pending.value) return
    busy.value = true
    error.value = ''
    const userId = identity.value.user?.id
    try {
      const result = await mutate(`/api/sessions/${sessionId}/fork`, {
        branchId: session.value.branchId,
        eventSeq,
      })
      if (validUser(userId)) session.value = GalgameSessionDTOSchema.parse(result)
    } catch (cause) {
      error.value = errorText(cause)
    } finally {
      if (validUser(userId)) busy.value = false
    }
  }
  onMounted(async () => {
    try {
      await ensure()
      const branchId = typeof route.query.branchId === 'string' ? String(route.query.branchId) : undefined
      await read(branchId)
      const saved = GalgameActionSchema.safeParse(await drafts.get(draftKey()).catch(() => undefined))
      pending.value =
        saved.success && session.value?.branches.some((branch) => branch.id === saved.data.branchId)
          ? saved.data
          : null
      progress.value = ''
      if (pending.value) {
        busy.value = true
        const found = await recover(pending.value)
        busy.value = false
        if (!found) error.value = '上次行动尚未确认。可以重试，或查询后更换行动。'
      } else if (session.value?.status === 'preparing') await act({ kind: 'begin' })
    } catch (cause) {
      error.value = errorText(cause)
      busy.value = false
      progress.value = ''
    }
  })
  watch(
    () => identity.value.user?.id,
    (value, previous) => {
      if (previous && value !== previous) {
        controller?.abort()
        session.value = null
        pending.value = null
        busy.value = false
        error.value = '账号已切换，请从我的旅程重新进入。'
      }
    },
  )
  onBeforeUnmount(() => {
    stopped = true
    controller?.abort()
  })
  return { session, busy, error, progress, pending, act, retry, discard, switchBranch, fork }
}
