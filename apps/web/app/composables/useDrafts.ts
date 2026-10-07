// Only the current user's bounded, expiring drafts/actions. Never credentials or authoritative saves.
export function useDrafts() {
  async function open() {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('careerscape-drafts', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  async function put(id: string, value: unknown) {
    const encoded = JSON.stringify(value)
    if (encoded.length > 15000) return
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      const store = tx.objectStore('drafts')
      store.put({ id, value, at: Date.now() })
      const request = store.getAll()
      request.onsuccess = () => {
        const rows = request.result.sort((a, b) => b.at - a.at)
        rows.forEach((row, i) => {
          if (i >= 20 || row.at < Date.now() - 7 * 86400000) store.delete(row.id)
        })
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  }
  async function get<T>(id: string): Promise<T | undefined> {
    const db = await open()
    const result = await new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').get(id)
      request.onsuccess = () =>
        resolve(request.result?.at > Date.now() - 7 * 86400000 ? (request.result.value as T) : undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return result
  }
  async function remove(id?: string) {
    const db = await open()
    const tx = db.transaction('drafts', 'readwrite')
    const store = tx.objectStore('drafts')
    if (id) store.delete(id)
    else store.clear()
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve()
    })
    db.close()
  }
  return { put, get, remove }
}
