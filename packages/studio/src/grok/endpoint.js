export const XAI_ORIGIN = "https://api.x.ai";
export const DEFAULT_MODEL = "grok-4.7";
export const STT_MODEL = "grok-voice-transcribe-2.0";

const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Only https://api.x.ai is a valid Grok endpoint. Paths are chosen by us. */
export function normalizeEndpoint(input) {
  const raw = (input || XAI_ORIGIN).trim();
  let url;
  try {
    url = new URL(raw);
  } catch (_error) {
    throw new Error("Grok endpoint must be https://api.x.ai");
  }

  if (url.protocol !== "https:") {
    throw new Error("Grok endpoint must use https");
  }
  if (url.hostname !== "api.x.ai") {
    throw new Error("Grok endpoint must be api.x.ai");
  }
  if (url.username || url.password) {
    throw new Error("Grok endpoint must not include credentials");
  }
  return XAI_ORIGIN;
}

export function assertModel(model) {
  const value = model || DEFAULT_MODEL;
  if (!MODEL_RE.test(value)) {
    throw new Error("Model id is not allowed");
  }
  return value;
}

export function chatCompletionsUrl() {
  return `${XAI_ORIGIN}/v1/chat/completions`;
}

export function modelsUrl() {
  return `${XAI_ORIGIN}/v1/models`;
}

export function speechToTextUrl() {
  return `${XAI_ORIGIN}/v1/stt`;
}
