import { boundingBoxOfMeshes, isUndoRequest } from "./bbox.js";

export { isUndoRequest };

export function geometryFacts(store) {
  const error = store?.error;
  return {
    boundingBox: boundingBoxOfMeshes(store?.currentMesh),
    error: error
      ? { message: error.message || String(error) }
      : null,
  };
}

export function createEditApplier(studio, getFacts) {
  return async function applyTool(name, args) {
    if (name === "get_state") {
      return {
        ...studio.getState(),
        geometry: getFacts(),
      };
    }

    if (name === "set_params") {
      const params = args?.params;
      if (!params || typeof params !== "object" || Array.isArray(params)) {
        return { ok: false, error: "params must be an object" };
      }
      const state = await studio.setParams(params);
      return {
        ok: !state.error,
        error: state.error,
        params: state.params,
        geometry: getFacts(),
      };
    }

    if (name === "set_script") {
      if (typeof args?.script !== "string" || !/\bmain\b/.test(args.script)) {
        return { ok: false, error: "script must define main" };
      }
      const state = await studio.loadScript(args.script);
      return {
        ok: !state.error,
        error: state.error,
        geometry: getFacts(),
      };
    }

    return { ok: false, error: `Unknown tool ${name}` };
  };
}

export async function undoLast(studio, history) {
  const previous = history.pop();
  if (!previous) return null;
  await studio.loadScript(previous.code);
  if (previous.params) await studio.setParams(previous.params);
  return studio.getState();
}
