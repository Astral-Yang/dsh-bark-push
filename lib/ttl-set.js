/**
 * A bounded, time-limited set used to suppress duplicate notifications.
 *
 * @module dsh-bark-push/ttl-set
 */

/**
 * Insertion-ordered set with per-entry expiry and a hard capacity. Old entries
 * are pruned on every insert, so a long-lived host cannot grow without bound.
 */
export class TtlSet {
  /**
   * @param {object} [options] - set options.
   * @param {number} [options.ttlMs] - entry lifetime.
   * @param {number} [options.capacity] - maximum retained keys.
   * @param {() => number} [options.now] - clock, injectable for tests.
   */
  constructor({ ttlMs = 10 * 60 * 1000, capacity = 512, now = Date.now } = {}) {
    this.ttlMs = Math.max(1000, Number(ttlMs) || 0);
    this.capacity = Math.max(16, Number(capacity) || 0);
    this.now = now;
    /** @type {Map<string, number>} key -> expiry timestamp */
    this.entries = new Map();
  }

  /**
   * Whether a key is present and unexpired.
   * @param {string} key - candidate key.
   * @returns {boolean} presence.
   */
  has(key) {
    const expiry = this.entries.get(key);
    if (expiry === undefined) return false;
    if (expiry <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Add a key. Existing keys refresh their expiry.
   * @param {string} key - key to remember.
   * @returns {boolean} true when the key was newly added.
   */
  add(key) {
    const fresh = !this.has(key);
    this.entries.delete(key);
    this.entries.set(key, this.now() + this.ttlMs);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return fresh;
  }

  /**
   * Remove expired entries.
   * @returns {number} removed count.
   */
  prune() {
    const now = this.now();
    let removed = 0;
    for (const [key, expiry] of this.entries) {
      if (expiry <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** @returns {number} retained key count. */
  get size() {
    return this.entries.size;
  }
}
