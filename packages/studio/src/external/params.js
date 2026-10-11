// Plain-object helpers for the parameter config the workbench already uses.
// Scripts declare `defaultParams` as either raw values (`{ height: 20 }`) or
// leva descriptors (`{ height: { value: 20, min: 1 } }`).

export function readParamValue(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "value")
  ) {
    return value.value;
  }
  return value;
}

export function valuesFromParamConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return {};
  }

  const values = {};
  Object.entries(config).forEach(([key, value]) => {
    if (key === "_run" || key.startsWith("_")) return;
    values[key] = readParamValue(value);
  });
  return values;
}

/**
 * Merge a partial patch onto script defaults and any overrides already applied.
 * The result is the full object passed to `main` as its second argument.
 */
export function mergeParams(defaults, overrides, patch) {
  return {
    ...valuesFromParamConfig(defaults),
    ...(overrides && typeof overrides === "object" ? overrides : {}),
    ...(patch && typeof patch === "object" ? patch : {}),
  };
}

/** Return a new leva/script config with patched values, keeping other fields. */
export function applyPatchToConfig(config, patch) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return config;
  }
  if (!patch || typeof patch !== "object") return { ...config };

  const next = { ...config };
  Object.entries(patch).forEach(([key, value]) => {
    const current = next[key];
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      Object.prototype.hasOwnProperty.call(current, "value")
    ) {
      next[key] = { ...current, value };
    } else {
      next[key] = value;
    }
  });
  return next;
}

export function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a plain object`);
  }
}
