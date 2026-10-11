function consider(min, max, x, y, z) {
  if (![x, y, z].every((value) => Number.isFinite(value))) return;
  min[0] = Math.min(min[0], x);
  min[1] = Math.min(min[1], y);
  min[2] = Math.min(min[2], z);
  max[0] = Math.max(max[0], x);
  max[1] = Math.max(max[1], y);
  max[2] = Math.max(max[2], z);
}

/** Axis-aligned box from the mesh already on screen. Geometry stays local. */
export function boundingBoxOfMeshes(meshList) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  (meshList || []).forEach((shape) => {
    const vertices = shape?.mesh?.vertices;
    if (!vertices || vertices.length < 3) return;
    for (let i = 0; i + 2 < vertices.length; i += 3) {
      consider(min, max, vertices[i], vertices[i + 1], vertices[i + 2]);
    }
  });

  if (!Number.isFinite(min[0])) return null;

  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

export function isUndoRequest(text) {
  return /^\s*undo(\s+that)?\s*[.!]?\s*$/i.test(text || "");
}
