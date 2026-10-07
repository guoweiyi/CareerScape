import type { Identity } from '~/types/game'
export function useIdentity() {
  const identity = useState<Identity>('identity', () => ({ user: null, csrfToken: null }))
  async function refresh() {
    identity.value = await $fetch<Identity>('/api/me')
    return identity.value
  }
  async function ensure() {
    await refresh()
    if (!identity.value.user) identity.value = await $fetch<Identity>('/api/guest', { method: 'POST' })
    return identity.value
  }
  async function mutate<T>(
    url: string,
    body: Record<string, unknown> = {},
    method: 'POST' | 'DELETE' = 'POST',
  ) {
    if (!identity.value.csrfToken) await ensure()
    return await $fetch<T>(url, { method, body, headers: { 'x-csrf-token': identity.value.csrfToken ?? '' } })
  }
  return { identity, refresh, ensure, mutate }
}
