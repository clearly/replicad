export const CHANNEL = "replicad-studio";

export const REQUEST_TYPES = [
  "loadScript",
  "setParams",
  "clearParams",
  "rebuild",
  "getState",
];

export function parseRequest(data) {
  if (!data || typeof data !== "object") return null;
  if (data.channel !== CHANNEL) return null;
  if (typeof data.type !== "string" || !REQUEST_TYPES.includes(data.type)) {
    return null;
  }

  return {
    type: data.type,
    requestId: data.requestId == null ? null : String(data.requestId),
    code: data.code,
    params: data.params,
    keepParams: Boolean(data.keepParams),
  };
}

export function originAllowed(origin, allowlist) {
  if (!allowlist || !allowlist.length) return true;
  return allowlist.includes(origin);
}

export function buildResponse(requestId, ok, extra = {}) {
  return {
    channel: CHANNEL,
    type: "response",
    requestId,
    ok,
    ...extra,
  };
}
