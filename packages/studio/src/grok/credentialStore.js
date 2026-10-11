import { del, get, set } from "idb-keyval";

import { assertModel, normalizeEndpoint, DEFAULT_MODEL } from "./endpoint.js";

const KEY_ID = "replicad-grok-key";
const SECRET_ID = "replicad-grok-secret";

/**
 * Per-browser Grok connection.
 * The API token is encrypted with a non-extractable AES-GCM key that stays in
 * IndexedDB. Callers never receive a storage record that contains the token,
 * and nothing here writes to localStorage, the URL, or a log.
 */
export function createCredentialStore(deps = {}) {
  const read = deps.get || get;
  const write = deps.set || set;
  const remove = deps.del || del;
  const subtle = deps.subtle || crypto.subtle;
  const random = deps.random || ((length) => crypto.getRandomValues(new Uint8Array(length)));

  let session = null;

  const getKey = async () => {
    const existing = await read(KEY_ID);
    if (existing) return existing;
    const key = await subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    await write(KEY_ID, key);
    return key;
  };

  const publicView = (connected) => {
    if (!session) return { connected: false, endpoint: null, model: null, remembered: false };
    return {
      connected,
      endpoint: session.endpoint,
      model: session.model,
      remembered: session.remembered,
    };
  };

  return {
    /** Status safe to render. Never includes the token. */
    status() {
      return publicView(Boolean(session?.token));
    },

    token() {
      return session?.token || null;
    },

    async hasSavedRecord() {
      const record = await read(SECRET_ID);
      return Boolean(record && record.cipher);
    },

    async save({ endpoint, token, model, remember }) {
      if (typeof token !== "string" || !token.trim()) {
        throw new Error("An API token is required");
      }
      const normalized = normalizeEndpoint(endpoint);
      const chosenModel = assertModel(model);
      const cleanToken = token.trim();
      session = {
        endpoint: normalized,
        model: chosenModel,
        token: cleanToken,
        remembered: Boolean(remember),
      };

      if (!remember) {
        await remove(SECRET_ID);
        return this.status();
      }

      const key = await getKey();
      const iv = random(12);
      const cipher = await subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(cleanToken)
      );
      await write(SECRET_ID, {
        v: 1,
        endpoint: normalized,
        model: chosenModel,
        iv: Array.from(iv),
        cipher: Array.from(new Uint8Array(cipher)),
      });
      return this.status();
    },

    async loadSaved() {
      const record = await read(SECRET_ID);
      if (!record?.cipher) return null;
      const key = await read(KEY_ID);
      if (!key) return null;

      const plain = await subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(record.iv) },
        key,
        new Uint8Array(record.cipher)
      );
      session = {
        endpoint: normalizeEndpoint(record.endpoint),
        model: assertModel(record.model || DEFAULT_MODEL),
        token: new TextDecoder().decode(plain),
        remembered: true,
      };
      return this.status();
    },

    disconnect() {
      session = null;
      return this.status();
    },

    async forget() {
      session = null;
      await remove(SECRET_ID);
      await remove(KEY_ID);
      return this.status();
    },
  };
}

export const grokCredentials = createCredentialStore();
