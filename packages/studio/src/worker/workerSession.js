import { shouldRecycleWorker } from "./recyclePolicy.js";

/**
 * One geometry worker, replaced when `shouldRecycleWorker` says the kernel
 * heap should be thrown away. `spawn` returns `{ api, terminate }`.
 */
export function createWorkerSession(spawn, options = {}) {
  const policy = options.policy || shouldRecycleWorker;
  let current = null;
  let buildsOnWorker = 0;
  let baselineBytes = null;

  const spawnCurrent = () => {
    current = spawn();
    buildsOnWorker = 0;
    baselineBytes = null;
    return current;
  };

  return {
    current() {
      if (!current) spawnCurrent();
      return current;
    },

    noteBuild() {
      buildsOnWorker += 1;
    },

    baseline() {
      return baselineBytes;
    },

    async recycleIfNeeded(heapBytes) {
      if (!current) return false;
      if (baselineBytes == null && typeof heapBytes === "number") {
        baselineBytes = heapBytes;
      }

      if (
        !policy({
          buildsOnWorker,
          heapBytes,
          baselineBytes,
        })
      ) {
        return false;
      }

      const dying = current;
      current = null;
      try {
        dying.terminate();
      } catch (_error) {
        // The worker may already be gone.
      }
      const next = spawnCurrent();
      if (typeof next.api?.ready === "function") {
        await next.api.ready();
      }
      return true;
    },
  };
}
