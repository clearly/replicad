/**
 * Run rebuilds one at a time. A request that arrives while a rebuild is in
 * flight replaces any already queued request (latest arguments win) and
 * resolves together with that queued run.
 */
export function createRebuildQueue(run) {
  let current = null;
  let pending = null;
  let idleWaiters = [];

  const notifyIdle = () => {
    if (current || pending) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  };

  const start = (entry) => {
    current = entry;
    Promise.resolve()
      .then(() => run(...entry.args))
      .then(
        (result) => {
          entry.waiters.forEach((waiter) => waiter.resolve(result));
        },
        (error) => {
          entry.waiters.forEach((waiter) => waiter.reject(error));
        }
      )
      .finally(() => {
        current = null;
        if (pending) {
          const next = pending;
          pending = null;
          start(next);
        } else {
          notifyIdle();
        }
      });
  };

  return {
    enqueue(...args) {
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject };
        if (current) {
          if (!pending) pending = { args, waiters: [] };
          else pending.args = args;
          pending.waiters.push(waiter);
          return;
        }
        start({ args, waiters: [waiter] });
      });
    },

    whenSettled() {
      if (!current && !pending) return Promise.resolve();
      return new Promise((resolve) => {
        idleWaiters.push(resolve);
      });
    },
  };
}
