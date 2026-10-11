// The worker is recycled between rebuilds (see workerSession). To debug the
// worker on the main thread, import "../builder.worker" directly instead.
import { wrap } from "comlink";
import CadWorker from "../builder.worker?worker";
import { createWorkerSession } from "../worker/workerSession.js";

const session = createWorkerSession(() => {
  const worker = new CadWorker();
  return {
    api: wrap(worker),
    terminate: () => worker.terminate(),
  };
});

const call = (method) => async (...args) => {
  const current = session.current();
  return current.api[method](...args);
};

const api = {
  ready: call("ready"),
  loadFont: call("loadFont"),
  computeLabels: call("computeLabels"),
  extractDefaultParamsFromCode: call("extractDefaultParamsFromCode"),
  extractDefaultNameFromCode: call("extractDefaultNameFromCode"),
  exportShape: call("exportShape"),
  edgeInfo: call("edgeInfo"),
  faceInfo: call("faceInfo"),
  heapStats: call("heapStats"),
  buildShapesFromCodeWithMetadata: async (...args) => {
    let current = session.current();
    let heap = null;
    try {
      const stats = await current.api.heapStats();
      heap = stats?.bytes ?? null;
    } catch (_error) {
      heap = null;
    }
    const recycled = await session.recycleIfNeeded(heap);
    if (recycled) current = session.current();
    session.noteBuild();
    return current.api.buildShapesFromCodeWithMetadata(...args);
  },
};

export default api;
