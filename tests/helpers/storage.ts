/**
 * A `localStorage` for jsdom, which has none here.
 *
 * vitest's jsdom environment gives these suites `window` but NOT
 * `window.localStorage` — verified against this project's jsdom 29 / vitest 4
 * setup. Without a stub every guarded storage call (`withStorage` in
 * lib/host-session.ts, `getPersistentPlayerId` in lib/use-buzzer-socket.ts)
 * takes its "storage unavailable" branch and a suite passes while testing
 * nothing. So the stub is load-bearing, and it is one module rather than a
 * copy per suite because three copies had already drifted in what they
 * returned. Each suite keeps its own canary test asserting the stub is
 * really installed; that is what makes the assertions after it mean anything.
 *
 * `installThrowingStorage` is Safari with "Block All Cookies" and the
 * embedded webviews that behave the same way: the *property access* throws,
 * before any method is called, which is the case lib/game-storage.ts and
 * lib/host-session.ts guard against and no real browser here reproduces on
 * demand.
 */

/**
 * Installs the stub and returns its backing map, for assertions on what was
 * (or was not) written. Nothing has needed the Storage object itself.
 */
export function installStorage(overrides: Partial<Storage> = {}): Map<string, string> {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
    ...overrides,
  };
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
  return map;
}

export function installThrowingStorage(): void {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
}

/**
 * Storage that reads fine and refuses every write: private mode on older
 * Safari, or a device over quota. The other half of "the browser will not
 * keep it", and the one a page can only discover on the write.
 */
export function installQuotaStorage(): Map<string, string> {
  return installStorage({
    setItem: () => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    },
  });
}

/** Back to jsdom's own state: no `localStorage` at all. */
export function uninstallStorage(): void {
  Object.defineProperty(window, "localStorage", { value: undefined, configurable: true, writable: true });
}
