/**
 * Per-key serialized mutex implemented as a promise chain.
 *
 * Used to serialize updates for the same hostname so that a client push
 * and a scheduler tick cannot race and double-dispatch to the upstream
 * provider.
 */
export class KeyedMutex<K = number> {
  private chain = new Map<K, Promise<void>>();

  async run<T>(key: K, fn: () => Promise<T>): Promise<T> {
    const prev = this.chain.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    const next = prev.then(() => current);
    this.chain.set(key, next);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.chain.get(key) === next) {
        this.chain.delete(key);
      }
    }
  }
}
