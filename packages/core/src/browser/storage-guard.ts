import type { KeyValueStorage } from "../core/types";

export const safeKeyValueStorage = (storage: KeyValueStorage): KeyValueStorage => ({
  getItem(key: string) {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      storage.setItem(key, value);
    } catch {
      // best-effort tab storage
    }
  },
});
