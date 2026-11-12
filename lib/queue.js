/**
 * A small bounded serial queue for notification delivery.
 *
 * Event handlers only enqueue; they never await a network request. The queue
 * caps memory, isolates task failures, and owns a disposal signal so a plugin
 * reload aborts in-flight Bark requests.
 *
 * @module dsh-bark-push/queue
 */

/**
 * FIFO queue with a concurrency limit and a hard pending bound.
 */
export class SerialQueue {
  /**
   * @param {object} [options] - queue options.
   * @param {number} [options.concurrency] - parallel tasks.
   * @param {number} [options.limit] - maximum pending tasks.
   * @param {{ warn: Function, debug: Function }} [options.logger] - redacting logger.
   */
  constructor({ concurrency = 1, limit = 100, logger } = {}) {
    this.concurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
    this.limit = Math.max(1, Math.floor(Number(limit) || 1));
    this.logger = logger;
    this.pending = [];
    this.active = 0;
    this.disposed = false;
    this.elapsed = 0;
  }

  /**
   * Enqueue one task. A full queue drops the task and reports why instead of
   * growing memory or stalling the event feed.
   * @param {() => Promise<unknown>} task - task body.
   * @param {string} [label] - diagnostic label.
   * @returns {boolean} whether the task was accepted.
   */
  push(task, label = 'notification') {
    if (this.disposed) return false;
    if (this.pending.length >= this.limit) {
      this.logger?.warn?.(`bark-push: 队列已满，丢弃一条${label}`);
      return false;
    }
    this.pending.push({ task, label });
    this.elapsed += 1;
    queueMicrotask(() => this.#pump());
    return true;
  }

  /** Start as many pending tasks as the concurrency allows. */
  #pump() {
    if (this.disposed) return;
    while (this.active < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      this.active += 1;
      Promise.resolve()
        .then(() => item.task())
        .catch((error) => {
          this.logger?.warn?.(`bark-push: ${item.label} 失败：${error?.message ?? String(error)}`);
        })
        .finally(() => {
          this.active -= 1;
          this.#pump();
        });
    }
  }

  /**
   * Stop accepting work and drop pending tasks. In-flight tasks are owned by
   * their own abort signal, which the runtime aborts on disposal.
   * @returns {void}
   */
  dispose() {
    this.disposed = true;
    this.pending.length = 0;
  }
}
