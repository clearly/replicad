import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { boundingBoxOfMeshes, isUndoRequest } from "../src/grok/bbox.js";
import { createEditApplier, undoLast } from "../src/grok/applyEdit.js";
import { runEdit, testConnection, transcribeAudio, xaiFetch } from "../src/grok/client.js";
import { createCredentialStore } from "../src/grok/credentialStore.js";
import { createEditSession } from "../src/grok/editSession.js";
import { normalizeEndpoint } from "../src/grok/endpoint.js";
import { redactSecret } from "../src/grok/redact.js";
import {
  REBUILD_HEAP_GROWTH_LIMIT,
  shouldRecycleWorker,
} from "../src/worker/recyclePolicy.js";
import { createWorkerSession } from "../src/worker/workerSession.js";

const TOKEN = "xai-test-token-do-not-log";

function memoryDb() {
  const map = new Map();
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async del(key) {
      map.delete(key);
    },
    map,
  };
}

function credentials() {
  const db = memoryDb();
  return {
    db,
    store: createCredentialStore({
      get: (key) => db.get(key),
      set: (key, value) => db.set(key, value),
      del: (key) => db.del(key),
    }),
  };
}

test("endpoint allowlist accepts only https://api.x.ai", () => {
  assert.equal(normalizeEndpoint(""), "https://api.x.ai");
  assert.equal(
    normalizeEndpoint("https://api.x.ai/v1/chat/completions"),
    "https://api.x.ai"
  );
  assert.throws(() => normalizeEndpoint("http://api.x.ai"), /https/);
  assert.throws(() => normalizeEndpoint("https://evil.example"), /api\.x\.ai/);
  assert.throws(
    () => normalizeEndpoint("https://user:secret@api.x.ai"),
    /credentials/
  );
});

test("redactSecret strips the token", () => {
  assert.equal(
    redactSecret(`bad ${TOKEN} request`, TOKEN),
    "bad [redacted] request"
  );
});

test("saved token is encrypted and round-trips", async () => {
  const { db, store } = credentials();
  await store.save({
    endpoint: "https://api.x.ai",
    token: TOKEN,
    model: "grok-4.7",
    remember: true,
  });

  const record = await db.get("replicad-grok-secret");
  assert.equal(JSON.stringify(record).includes(TOKEN), false);
  assert.ok(record.cipher.length > 16);
  assert.equal(record.endpoint, "https://api.x.ai");

  store.disconnect();
  assert.equal(store.token(), null);
  const loaded = await store.loadSaved();
  assert.equal(loaded.connected, true);
  assert.equal(store.token(), TOKEN);
  assert.equal(JSON.stringify(loaded).includes(TOKEN), false);

  await store.forget();
  assert.equal(await db.get("replicad-grok-secret"), undefined);
  assert.equal(await store.loadSaved(), null);
});

test("a session-only connection is not written to storage", async () => {
  const { db, store } = credentials();
  await store.save({
    endpoint: "https://api.x.ai",
    token: TOKEN,
    remember: false,
  });
  assert.equal(store.token(), TOKEN);
  assert.equal(await db.get("replicad-grok-secret"), undefined);
});

test("xaiFetch refuses other hosts and query strings", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
  };

  await assert.rejects(
    () => xaiFetch("https://evil.example/v1/chat/completions", TOKEN, {}, fetchImpl),
    /api\.x\.ai/
  );
  await assert.rejects(
    () => xaiFetch("https://api.x.ai/v1/stt?token=secret", TOKEN, {}, fetchImpl),
    /query/
  );
  assert.equal(calls.length, 0);
});

test("connection test sends the token only in the Authorization header", async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, authorization: init.headers.get("Authorization") };
    return { ok: true, status: 200, text: async () => "{\"data\":[]}" };
  };

  await testConnection({ token: TOKEN, endpoint: "https://api.x.ai", fetchImpl });
  assert.equal(seen.url, "https://api.x.ai/v1/models");
  assert.equal(seen.authorization, `Bearer ${TOKEN}`);
  assert.equal(seen.url.includes(TOKEN), false);
});

test("failed xAI responses do not echo the token", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => `invalid ${TOKEN}`,
  });

  await assert.rejects(
    () => testConnection({ token: TOKEN, endpoint: "https://api.x.ai", fetchImpl }),
    (error) => {
      assert.equal(error.message.includes(TOKEN), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    }
  );
});

test("runEdit applies a parameter patch then stops", async () => {
  const applied = [];
  const urls = [];
  let round = 0;
  const fetchImpl = async (url, init) => {
    urls.push(url);
    assert.equal(init.headers.get("Authorization"), `Bearer ${TOKEN}`);
    assert.equal(url.includes(TOKEN), false);
    round += 1;
    const body =
      round === 1
        ? {
            choices: [
              {
                message: {
                  content: "",
                  tool_calls: [
                    {
                      id: "call-1",
                      function: {
                        name: "set_params",
                        arguments: JSON.stringify({ params: { height: 30 } }),
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {
            choices: [
              { message: { content: "Height is 30.", tool_calls: [] } },
            ],
          };
    return { ok: true, status: 200, json: async () => body, text: async () => "" };
  };

  const summary = await runEdit({
    token: TOKEN,
    endpoint: "https://api.x.ai",
    userText: "make it 30 tall",
    getContext: () => ({ code: "const main = () => 1;", params: null }),
    applyTool: async (name, args) => {
      applied.push({ name, args });
      return { ok: true, error: null, params: args.params };
    },
    fetchImpl,
  });

  assert.equal(summary.summary, "Height is 30.");
  assert.deepEqual(applied, [
    { name: "set_params", args: { params: { height: 30 } } },
  ]);
  assert.deepEqual(urls, [
    "https://api.x.ai/v1/chat/completions",
    "https://api.x.ai/v1/chat/completions",
  ]);
});

test("transcription posts audio only to the xAI speech endpoint", async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, authorization: init.headers.get("Authorization"), body: init.body };
    return {
      ok: true,
      status: 200,
      json: async () => ({ text: "add a lid" }),
    };
  };

  const text = await transcribeAudio({
    token: TOKEN,
    blob: new Blob(["audio"], { type: "audio/webm" }),
    fetchImpl,
  });
  assert.equal(text, "add a lid");
  assert.equal(seen.url, "https://api.x.ai/v1/stt");
  assert.equal(seen.authorization, `Bearer ${TOKEN}`);
  assert.equal(seen.body instanceof FormData, true);
});

function fakeStudio() {
  const state = {
    code: "const defaultParams = { height: 10 };\nconst main = () => 1;\n",
    params: null,
    defaults: { height: 10 },
    error: null,
    shapeCount: 1,
    shapes: [{ name: "Shape" }],
  };
  return {
    state,
    getState: () => ({ ...state, params: state.params ? { ...state.params } : null }),
    async setParams(patch) {
      state.params = { ...(state.params || {}), ...patch };
      return this.getState();
    },
    async loadScript(code) {
      state.code = code;
      state.params = null;
      return this.getState();
    },
    async clearParams() {
      state.params = null;
      return this.getState();
    },
  };
}

test("edit session undoes a script change without calling the model", async () => {
  const studio = fakeStudio();
  const { store } = credentials();
  await store.save({
    endpoint: "https://api.x.ai",
    token: TOKEN,
    remember: false,
  });
  let calls = 0;
  const session = createEditSession({
    credentials: store,
    studio,
    getFacts: () => ({ boundingBox: null, error: null }),
    run: async () => {
      calls += 1;
      await studio.loadScript("const main = () => 2;\n");
      return { summary: "Replaced the script." };
    },
  });

  await session.submit("add a handle");
  assert.equal(calls, 1);
  assert.match(studio.state.code, /=> 2/);

  const undone = await session.submit("undo that");
  assert.equal(calls, 1);
  assert.match(undone.summary, /Undid/);
  assert.match(studio.state.code, /height: 10/);
});

test("applier reports geometry after a param change", async () => {
  const studio = fakeStudio();
  const facts = { boundingBox: { size: [1, 2, 3] }, error: null };
  const apply = createEditApplier(studio, () => facts);
  const result = await apply("set_params", { params: { height: 4 } });
  assert.equal(result.ok, true);
  assert.deepEqual(result.params, { height: 4 });
  assert.deepEqual(result.geometry.boundingBox.size, [1, 2, 3]);
  assert.equal((await apply("set_script", { script: "nope" })).ok, false);
});

test("undo request recognises the voice phrasing", () => {
  assert.equal(isUndoRequest("undo"), true);
  assert.equal(isUndoRequest("Undo that."), true);
  assert.equal(isUndoRequest("undo the fillet"), false);
});

test("bounding box reads mesh vertices already on screen", () => {
  const box = boundingBoxOfMeshes([
    { mesh: { vertices: [0, 0, 0, 10, 4, 2] } },
  ]);
  assert.deepEqual(box.size, [10, 4, 2]);
  assert.equal(boundingBoxOfMeshes([]), null);
});

test("undoLast restores code and params", async () => {
  const studio = fakeStudio();
  await studio.setParams({ height: 3 });
  const history = [{ code: studio.state.code, params: { height: 9 } }];
  await undoLast(studio, history);
  assert.deepEqual(studio.state.params, { height: 9 });
  assert.equal(history.length, 0);
  assert.equal(await undoLast(studio, history), null);
});

test("worker recycles on build count and heap growth", async () => {
  assert.equal(
    shouldRecycleWorker({ buildsOnWorker: 7, heapBytes: 10, baselineBytes: 10 }),
    false
  );
  assert.equal(
    shouldRecycleWorker({
      buildsOnWorker: 1,
      heapBytes: REBUILD_HEAP_GROWTH_LIMIT + 5,
      baselineBytes: 0,
    }),
    true
  );

  const spawned = [];
  const session = createWorkerSession(() => {
    const worker = {
      terminated: false,
      api: { ready: async () => true },
    };
    spawned.push(worker);
    return {
      api: worker.api,
      terminate: () => {
        worker.terminated = true;
      },
    };
  });

  session.current();
  for (let i = 0; i < 8; i += 1) {
    assert.equal(await session.recycleIfNeeded(100), false);
    session.noteBuild();
  }
  assert.equal(await session.recycleIfNeeded(100), true);
  assert.equal(spawned.length, 2);
  assert.equal(spawned[0].terminated, true);
  assert.equal(spawned[1].terminated, false);

  session.noteBuild();
  assert.equal(await session.recycleIfNeeded(100), false);
  assert.equal(
    await session.recycleIfNeeded(100 + REBUILD_HEAP_GROWTH_LIMIT),
    true
  );
  assert.equal(spawned.length, 3);
  assert.equal(spawned[1].terminated, true);
});

test("the geometry worker never imports the Grok credential store", () => {
  const worker = fs.readFileSync(
    new URL("../src/builder.worker.js", import.meta.url),
    "utf8"
  );
  const share = fs.readFileSync(
    new URL("../src/visualiser/editor/codeInit.js", import.meta.url),
    "utf8"
  );
  assert.equal(worker.includes("grok"), false);
  assert.equal(worker.includes("credentialStore"), false);
  assert.equal(share.includes("grok"), false);
  assert.equal(share.includes("localStorage.setItem(\"grok"), false);
});
