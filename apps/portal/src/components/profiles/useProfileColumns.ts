import { shallowRef, watch } from 'vue'
const available = [
  'status',
  'runtimeProxyHealth',
  'worker',
  'groups',
  'access',
  'capacity',
  'storage',
  'updatedAt',
] as const
const defaults: string[] = ['status', 'worker', 'capacity']
const storageKey = 'browshare.profile-columns.v1'
export function useProfileColumns() {
  const selected = shallowRef<string[]>(read())
  function read(): string[] {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (Array.isArray(value)) return available.filter((key) => value.includes(key))
    } catch {
      /* Storage is optional for this presentation preference. */
    }
    return [...defaults]
  }
  watch(selected, (value) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* Keep in-memory selection. */
    }
  })
  return {
    selected,
    reset: () => {
      selected.value = [...defaults]
    },
  }
}
