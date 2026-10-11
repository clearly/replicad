import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPatchToConfig,
  mergeParams,
  valuesFromParamConfig,
} from "../src/external/params.js";
import {
  CHANNEL,
  buildResponse,
  originAllowed,
  parseRequest,
} from "../src/external/protocol.js";
import { createRebuildQueue } from "../src/external/rebuildQueue.js";
import {
  attachExternalControl,
  createExternalControl,
} from "../src/external/createExternalControl.js";

const DEFAULTS = {
  height: 10,
  width: { value: 5, min: 1, max: 20 },
  _run: { type: "BUTTON" },
};

test("reads leva descriptors and skips internal keys", () => {
  assert.deepEqual(valuesFromParamConfig(DEFAULTS), {
    height: 10,
    width: 5,
  });
});

test("merges a patch onto defaults and earlier overrides", () => {
  assert.deepEqual(mergeParams(DEFAULTS, { height: 12 }, { width: 8 }), {
    height: 12,
    width: 8,
  });
});

test("patches a config in place without dropping leva metadata", () => {
  const next = applyPatchToConfig(DEFAULTS, { width: 9, height: 3 });
  assert.equal(next.height, 3);
  assert.deepEqual(next.width, { value: 9, min: 1, max: 20 });
  assert.equal(next._run, DEFAULTS._run);
  assert.equal(DEFAULTS.width.value, 5);
});

test("parseRequest accepts the studio channel only", () => {
  assert.equal(parseRequest(null), null);
  assert.equal(parseRequest({ type: "loadScript" }), null);
  assert.equal(
    parseRequest({ channel: CHANNEL, type: "nope" }),
    null
  );

  const request = parseRequest({
    channel: CHANNEL,
    type: "setParams",
    requestId: 4,
    params: { height: 2 },
    keepParams: 1,
  });
  assert.equal(request.type, "setParams");
  assert.equal(request.requestId, "4");
  assert.equal(request.keepParams, true);
  assert.deepEqual(request.params, { height: 2 });
});

test("origin allowlist is open unless configured", () => {
  assert.equal(originAllowed("https://evil.example", null), true);
  assert.equal(originAllowed("https://evil.example", []), true);
  assert.equal(
    originAllowed("https://ok.example", ["https://ok.example"]),
    true
  );
  assert.equal(
    originAllowed("https://evil.example", ["https://ok.example"]),
    false
  );
});

test("rebuild queue runs the latest queued arguments once", async () => {
  const seen = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = 0;
  const queue = createRebuildQueue(async (value) => {
    started += 1;
    if (started === 1) await gate;
    seen.push(value);
    return value;
  });

  const first = queue.enqueue("a");
  await Promise.resolve();
  assert.equal(started, 1);
  const second = queue.enqueue("b");
  const third = queue.enqueue("c");

  const idle = queue.whenSettled();
  release();
  assert.deepEqual(await Promise.all([first, second, third]), ["a", "c", "c"]);
  await idle;
  assert.deepEqual(seen, ["a", "c"]);
});

function createFakeStore(initial = "const main = () => 1;\n") {
  let code = initial;
  const builds = [];
  const store = {
    get currentValues() {
      return { code };
    },
    paramOverrides: null,
    scriptDefaults: { height: 10, width: 5 },
    defaultParams: { height: 10, width: 5 },
    error: false,
    processing: false,
    shapeLoaded: false,
    currentMesh: [],
    externalCode: false,
    builds,
    markExternalCode() {
      store.externalCode = true;
    },
    setParamOverrides(params) {
      store.paramOverrides = params ? { ...params } : null;
    },
    clearParamOverrides() {
      store.paramOverrides = null;
    },
    async ensureDefaultParams() {
      return store.scriptDefaults;
    },
  };

  const queue = createRebuildQueue(async (params) => {
    store.processing = true;
    const used =
      params !== undefined
        ? params
        : store.paramOverrides
        ? mergeParams(store.scriptDefaults, null, store.paramOverrides)
        : undefined;
    await Promise.resolve();
    builds.push({ code, params: used });
    store.currentMesh = [{ name: "Shape" }];
    store.shapeLoaded = true;
    store.processing = false;
    store.error = code.includes("boom")
      ? { error: true, message: "boom" }
      : false;
  });

  store.rebuild = (params) => queue.enqueue(params);
  store.whenSettled = () => queue.whenSettled();
  store.code = {
    update(next) {
      // MobX skips the autorun when the script text is unchanged.
      if (next === code) return;
      code = next;
      queue.enqueue();
    },
  };

  return store;
}

test("loadScript rebuilds in place and setParams merges onto defaults", async () => {
  const store = createFakeStore();
  const api = createExternalControl(store);

  const script = "const defaultParams = { height: 10 };\nconst main = () => 1;\n";
  const loaded = await api.loadScript(script);
  assert.equal(loaded.code, script);
  assert.equal(loaded.shapeLoaded, true);
  assert.equal(loaded.params, null);
  assert.equal(store.externalCode, true);
  assert.equal(store.builds.length, 1);
  assert.equal(store.builds[0].params, undefined);

  const updated = await api.setParams({ height: 30 });
  assert.deepEqual(updated.params, { height: 30 });
  assert.equal(store.builds.length, 2);
  assert.deepEqual(store.builds[1].params, { height: 30, width: 5 });

  const again = await api.setParams({ width: 2 });
  assert.deepEqual(again.params, { height: 30, width: 2 });
  assert.deepEqual(store.builds[2].params, { height: 30, width: 2 });

  await api.clearParams();
  assert.equal(store.paramOverrides, null);
  assert.equal(store.builds.at(-1).params, undefined);
});

test("reloading a script drops parameter overrides unless asked not to", async () => {
  const store = createFakeStore();
  const api = createExternalControl(store);
  await api.loadScript("const main = () => 1;\n");
  await api.setParams({ height: 4 });

  const next = "const main = () => 2;\n";
  await api.loadScript(next);
  assert.equal(store.paramOverrides, null);
  assert.equal(store.builds.at(-1).code, next);
  assert.equal(store.builds.at(-1).params, undefined);

  await api.setParams({ height: 4 });
  await api.loadScript("const main = () => 3;\n", { keepParams: true });
  assert.deepEqual(store.paramOverrides, { height: 4 });
  assert.deepEqual(store.builds.at(-1).params, { height: 4, width: 5 });
});

test("loading the same script still requests a rebuild", async () => {
  const store = createFakeStore("const main = () => 1;\n");
  const api = createExternalControl(store);
  await api.loadScript("const main = () => 1;\n");
  assert.equal(store.builds.length, 1);
});

test("postMessage round trip and origin allowlist", async () => {
  const store = createFakeStore();
  const listeners = [];
  const target = {
    replicadExternalOrigins: ["https://host.example"],
    addEventListener(_type, fn) {
      listeners.push(fn);
    },
    removeEventListener(_type, fn) {
      const index = listeners.indexOf(fn);
      if (index >= 0) listeners.splice(index, 1);
    },
  };

  const dispose = attachExternalControl(store, { target });
  assert.equal(typeof target.replicadStudio.loadScript, "function");

  const replies = [];
  const source = {
    postMessage(data) {
      replies.push(data);
    },
  };

  listeners[0]({
    origin: "https://other.example",
    data: {
      channel: CHANNEL,
      type: "getState",
      requestId: "blocked",
    },
    source,
  });

  listeners[0]({
    origin: "https://host.example",
    data: {
      channel: CHANNEL,
      type: "loadScript",
      requestId: "ok",
      code: "const main = () => 9;\n",
    },
    source,
  });

  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, true);
  assert.equal(replies[0].requestId, "ok");
  assert.equal(replies[0].channel, CHANNEL);
  assert.equal(replies[0].state.code, "const main = () => 9;\n");
  assert.equal(replies[0].state.shapeCount, 1);
  assert.deepEqual(buildResponse("ok", true).ok, true);

  const failed = [];
  listeners[0]({
    origin: "https://host.example",
    data: { channel: CHANNEL, type: "loadScript", requestId: "bad", code: "  " },
    source: {
      postMessage(data) {
        failed.push(data);
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(failed[0].ok, false);
  assert.match(failed[0].error.message, /non-empty/);

  dispose();
  assert.equal(target.replicadStudio, undefined);
  assert.equal(listeners.length, 0);
});

test("unrelated postMessage payloads are ignored", async () => {
  const store = createFakeStore();
  const listeners = [];
  const target = {
    addEventListener(_type, fn) {
      listeners.push(fn);
    },
    removeEventListener() {},
  };
  attachExternalControl(store, { target });

  const replies = [];
  listeners[0]({
    origin: "https://host.example",
    data: { type: "loadScript", code: "no channel" },
    source: {
      postMessage(data) {
        replies.push(data);
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replies.length, 0);
  assert.equal(store.builds.length, 0);
});
