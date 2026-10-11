function describeError(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: error, stack: null };

  const message =
    error.message || (typeof error.error === "string" ? error.error : null);
  if (!message && !error.stack) return null;

  return {
    message: message || "error",
    stack: error.stack || null,
  };
}

/** State safe to hand to outside code. Mesh buffers stay in the viewer. */
export function snapshotState(store) {
  const mesh = Array.isArray(store.currentMesh) ? store.currentMesh : [];

  return {
    code: store.currentValues?.code || "",
    params: store.paramOverrides ? { ...store.paramOverrides } : null,
    defaults: store.scriptDefaults
      ? { ...store.scriptDefaults }
      : store.defaultParams
      ? { ...store.defaultParams }
      : null,
    error: describeError(store.error),
    processing: Boolean(store.processing),
    shapeLoaded: Boolean(store.shapeLoaded),
    shapeCount: mesh.length,
    shapes: mesh.map((shape) => ({ name: shape?.name || "Shape" })),
  };
}
