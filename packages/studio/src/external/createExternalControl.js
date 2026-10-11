import { mergeParams, assertPlainObject } from "./params.js";
import { parseRequest, buildResponse, originAllowed } from "./protocol.js";
import { snapshotState } from "./snapshot.js";

function assertScript(code) {
  if (typeof code !== "string" || !code.trim()) {
    throw new Error("loadScript requires a non-empty script string");
  }
}

/**
 * Outside control of the workbench: load a script, change parameter values,
 * and rebuild, without reloading the page.
 *
 * `store` is the workbench AppState. Code updates already schedule a rebuild
 * (the store autorun); this waits for that rebuild to finish.
 */
export function createExternalControl(store) {
  async function settle() {
    if (typeof store.whenSettled === "function") {
      await store.whenSettled();
    }
    return snapshotState(store);
  }

  async function loadScript(code, options = {}) {
    assertScript(code);
    if (!options.keepParams && typeof store.clearParamOverrides === "function") {
      store.clearParamOverrides();
    }
    if (typeof store.markExternalCode === "function") {
      store.markExternalCode();
    }

    const changed = (store.currentValues?.code || "") !== code;
    store.code.update(code, true);
    if (!changed && typeof store.rebuild === "function") {
      await store.rebuild();
    }
    return settle();
  }

  async function setParams(patch) {
    assertPlainObject(patch, "params");
    if (typeof store.ensureDefaultParams === "function") {
      await store.ensureDefaultParams();
    }

    const overrides = {
      ...(store.paramOverrides || {}),
      ...patch,
    };
    store.setParamOverrides(overrides);

    const merged = mergeParams(store.scriptDefaults, null, overrides);
    if (typeof store.rebuild === "function") {
      await store.rebuild(merged);
    }
    return snapshotState(store);
  }

  async function clearParams() {
    if (typeof store.clearParamOverrides === "function") {
      store.clearParamOverrides();
    }
    if (typeof store.rebuild === "function") {
      await store.rebuild();
    }
    return settle();
  }

  async function rebuild() {
    if (typeof store.rebuild === "function") {
      await store.rebuild();
    }
    return settle();
  }

  function getState() {
    return snapshotState(store);
  }

  async function handleRequest(request) {
    switch (request.type) {
      case "loadScript":
        return loadScript(request.code, { keepParams: request.keepParams });
      case "setParams":
        return setParams(request.params);
      case "clearParams":
        return clearParams();
      case "rebuild":
        return rebuild();
      case "getState":
        return getState();
      default:
        throw new Error(`Unknown request "${request.type}"`);
    }
  }

  return {
    loadScript,
    setParams,
    clearParams,
    rebuild,
    getState,
    handleRequest,
  };
}

/**
 * Publish `window.replicadStudio` and answer `postMessage` requests.
 * Returns a dispose function.
 */
export function attachExternalControl(store, options = {}) {
  const target =
    options.target || (typeof window !== "undefined" ? window : null);
  const api = createExternalControl(store);

  if (!target || typeof target.addEventListener !== "function") {
    return function disposeExternalControl() {
      return undefined;
    };
  }

  const onMessage = (event) => {
    const request = parseRequest(event?.data);
    if (!request) return;

    const allowlist =
      typeof options.getAllowedOrigins === "function"
        ? options.getAllowedOrigins()
        : target.replicadExternalOrigins;
    if (!originAllowed(event.origin, allowlist)) return;

    const replyTo = event.source;
    const targetOrigin = event.origin && event.origin !== "null" ? event.origin : "*";

    api.handleRequest(request).then(
      (state) => {
        replyTo?.postMessage?.(
          buildResponse(request.requestId, true, { state }),
          targetOrigin
        );
      },
      (error) => {
        replyTo?.postMessage?.(
          buildResponse(request.requestId, false, {
            error: { message: error?.message || "Request failed" },
          }),
          targetOrigin
        );
      }
    );
  };

  target.addEventListener("message", onMessage);
  target.replicadStudio = api;

  return () => {
    target.removeEventListener("message", onMessage);
    if (target.replicadStudio === api) {
      delete target.replicadStudio;
    }
  };
}
