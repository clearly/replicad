# Grok voice in the workbench

On `/workbench`, the bar under the editor sends a spoken or typed change to
Grok. Grok replies with a parameter patch or a new script. The workbench
rebuilds the model in place through the external control API
(`window.replicadStudio`), so the page and the camera stay put.

## Connect

The first time, enter an xAI API token. The endpoint is fixed to
`https://api.x.ai`. "Remember on this device" encrypts the token with
AES-GCM under a non-extractable key in IndexedDB. The token is not written
to `localStorage`, the URL, share links, logs, or the geometry worker.
"Use saved" loads that record. "Disconnect" drops the in-memory copy.
"Forget" deletes the record and the key.

Leave "Remember" unchecked on a shared computer. The token then lives only
for the session.

Requests go to `api.x.ai` only: chat completions for edits, `GET /v1/models`
to test the token, and `POST /v1/stt` when audio is transcribed by xAI.
The token travels in the `Authorization` header, never in the URL.

## Voice

Hold **Hold to talk** (or Ctrl+Shift+Space outside the editor and text
fields).

- With a connection, the recording is sent to xAI speech-to-text
  (`grok-voice-transcribe-2.0`) and the transcript is applied.
- "Browser speech" uses the browser's own speech recognizer for a live
  transcript. That audio goes to the browser's speech service, not to xAI,
  and the Grok token is not involved. Use it when you want to see words as
  you speak.

Type a change and press Send if the microphone is unavailable. "undo" or
"undo that" restores the previous script and parameters.

The model is `grok-4.7` by default. It can call `set_params`, `set_script`,
and `get_state` (script, parameters, last error, bounding box of the mesh
on screen). One failed rebuild is fed back so it can correct itself.

## Rebuild memory

Each successful rebuild deletes the previous build's OpenCascade shapes
once the mesh has been copied out, so only the latest solid stays alive for
export and picking. On this OpenCascade build, `shape.delete()` does not
return wasm memory to the browser: the heap stays at its high-water mark.
The geometry worker is therefore replaced every 8 rebuilds, or sooner if
its wasm heap grows by 32 MB. A new worker starts from the initial heap.
Export keeps working against the latest build until that recycle.

Measured with 5,000 `makeBaseBox(10, 10, 10)` calls
(`shape-memory.test.ts`):

| | Wasm heap |
|---|---|
| Before | 104,857,600 bytes |
| After retaining every box | 133,234,688 bytes (+28,377,088) |
| After `delete()` on those boxes | 133,234,688 bytes (no shrink) |
| Fresh OpenCascade instance (worker recycle) | 104,857,600 bytes |

The worker policy is covered by `packages/studio/__tests__/grok-voice.test.js`.

## Run

```bash
npm install
npm run build --workspace=replicad
npm run build --workspace=replicad-evaluator
npm test --workspace=studio
npm run start --workspace=studio
```

Open `http://localhost:5555/workbench`. The token is yours; this app does
not ship one.
