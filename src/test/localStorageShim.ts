// In-memory localStorage shim for deterministic tests. Node's experimental
// web storage persists to a file and can leak state across runs; this Map-backed
// Storage is installed fresh per test so settings specs are isolated.

export function installMemoryLocalStorage(): Storage {
  const map = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    }
  }
  ;(globalThis as { localStorage: Storage }).localStorage = storage
  return storage
}

