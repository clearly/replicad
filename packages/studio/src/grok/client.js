import {
  assertModel,
  chatCompletionsUrl,
  DEFAULT_MODEL,
  modelsUrl,
  normalizeEndpoint,
  speechToTextUrl,
  STT_MODEL,
} from "./endpoint.js";
import { redactSecret } from "./redact.js";

const TOOLS = [
  {
    type: "function",
    function: {
      name: "set_params",
      description:
        "Update parameters of the current replicad script and rebuild. Prefer this when the request only changes sizes, counts, or booleans that already exist.",
      parameters: {
        type: "object",
        properties: {
          params: {
            type: "object",
            description: "Partial map of parameter name to number, string, or boolean.",
            additionalProperties: true,
          },
        },
        required: ["params"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_script",
      description:
        "Replace the whole script when the shape needs a structural change. Keep a main function and defaultParams.",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string" },
        },
        required: ["script"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_state",
      description:
        "Read the current script, parameters, last error, and bounding box.",
      parameters: { type: "object", properties: {} },
    },
  },
];

const SYSTEM = [
  "You edit a replicad CAD script running in the user's browser.",
  "Prefer set_params for numeric or boolean tweaks. Use set_script only when the geometry has to change structure.",
  "After a tool result that includes an error, fix it with one more tool call.",
  "Do not invent parameters that are not in the script unless you also replace the script.",
  "Finish with a one-sentence confirmation. Never repeat or ask for API tokens.",
].join(" ");

export async function xaiFetch(url, token, init = {}, fetchImpl = fetch) {
  const parsed = new URL(url);
  if (parsed.origin !== normalizeEndpoint(parsed.origin)) {
    throw new Error("Refusing to send the Grok token to this host");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Refusing to put a Grok request in a URL query");
  }

  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response;
  try {
    response = await fetchImpl(url, { ...init, headers });
  } catch (error) {
    throw new Error(
      redactSecret(error?.message || "Network error talking to xAI", token)
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = redactSecret(await response.text(), token).slice(0, 240);
    } catch (_error) {
      detail = "";
    }
    throw new Error(`xAI request failed (${response.status}) ${detail}`.trim());
  }
  return response;
}

export async function testConnection({
  token,
  endpoint,
  fetchImpl = fetch,
}) {
  normalizeEndpoint(endpoint);
  const response = await xaiFetch(modelsUrl(), token, { method: "GET" }, fetchImpl);
  await response.text();
  return { ok: true, endpoint: normalizeEndpoint(endpoint) };
}

export async function transcribeAudio({
  token,
  blob,
  filename = "speech.webm",
  fetchImpl = fetch,
}) {
  const body = new FormData();
  body.append("model", STT_MODEL);
  body.append("language", "en");
  body.append("file", blob, filename);
  const response = await xaiFetch(
    speechToTextUrl(),
    token,
    { method: "POST", body },
    fetchImpl
  );
  const payload = await response.json();
  return typeof payload?.text === "string" ? payload.text : "";
}

function parseArguments(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return {};
  }
}

export async function runEdit({
  token,
  endpoint,
  model = DEFAULT_MODEL,
  userText,
  getContext,
  applyTool,
  fetchImpl = fetch,
  maxRounds = 4,
}) {
  normalizeEndpoint(endpoint);
  const chosenModel = assertModel(model);
  const messages = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        request: userText,
        ...(getContext ? getContext() : {}),
      }),
    },
  ];

  let summary = "";
  for (let round = 0; round < maxRounds; round += 1) {
    const response = await xaiFetch(
      chatCompletionsUrl(),
      token,
      {
        method: "POST",
        body: JSON.stringify({
          model: chosenModel,
          messages,
          tools: TOOLS,
          temperature: 0.2,
        }),
      },
      fetchImpl
    );
    const payload = await response.json();
    const message = payload?.choices?.[0]?.message;
    if (!message) throw new Error("Empty response from Grok");

    messages.push({
      role: "assistant",
      content: message.content || "",
      tool_calls: message.tool_calls,
    });

    const calls = message.tool_calls || [];
    if (!calls.length) {
      summary = message.content || summary || "Done.";
      break;
    }

    for (const call of calls) {
      const name = call.function?.name;
      const args = parseArguments(call.function?.arguments);
      const result = await applyTool(name, args);
      if (result?.summary) summary = result.summary;
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
    summary = summary || "Updated the model.";
  }

  return { summary: summary || "Done." };
}
