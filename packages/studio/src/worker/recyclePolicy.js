// Recycle the geometry worker often enough that a long editing session does
// not keep the OpenCascade heap at its high-water mark. Deleting individual
// shapes stops the leak; replacing the worker returns that memory to the OS.
export const REBUILD_RECYCLE_EVERY = 8;
export const REBUILD_HEAP_GROWTH_LIMIT = 32 * 1024 * 1024;

export function shouldRecycleWorker({
  buildsOnWorker,
  heapBytes,
  baselineBytes,
}) {
  if (buildsOnWorker >= REBUILD_RECYCLE_EVERY) return true;
  if (
    baselineBytes != null &&
    typeof heapBytes === "number" &&
    heapBytes - baselineBytes >= REBUILD_HEAP_GROWTH_LIMIT
  ) {
    return true;
  }
  return false;
}
