# External control API

The workbench can load a script, change parameter values, and rebuild the
model without reloading the page. The same handle is available on the
visualiser. Nothing here is specific to a particular editor integration: any
outside code that can reach the page (a parent frame, an extension, a test)
can use it.

Geometry still builds in the existing worker. The camera and the page stay
put; a rebuild swaps the mesh in the current viewer.

## JavaScript

On `/workbench` or `/visualiser`:

```js
const studio = window.replicadStudio;

await studio.loadScript(`
const { makeBaseBox } = replicad;
const defaultParams = { width: 20, depth: 10, height: 5 };
const main = (_r, { width, depth, height }) =>
  makeBaseBox(width, depth, height);
`);

await studio.setParams({ width: 40, height: 12 });
await studio.rebuild();

studio.getState();
// { code, params, defaults, error, processing, shapeLoaded, shapeCount, shapes }

await studio.clearParams();
```

`loadScript` replaces the editor buffer and the model. It drops parameter
overrides unless you pass `{ keepParams: true }`. `setParams` merges a partial
object onto the script's `defaultParams` (including leva-style
`{ value, min, max }` entries) and rebuilds. Later edits keep that patch
until `clearParams` or another `loadScript`.

Each call resolves with the same snapshot as `getState()`. `error` is set
when the script fails; the previous successful API call's shape stays
available according to the viewer's existing error behaviour. Mesh buffers
are not part of the snapshot.

Listen for every finished rebuild, including ones started by typing:

```js
window.addEventListener("replicad-studio", (event) => {
  console.log(event.detail.shapeCount, event.detail.error);
});
```

## postMessage

Use this from a parent page. Messages need `channel: "replicad-studio"`.
Other messages on the page are ignored.

```js
const frame = document.querySelector("iframe").contentWindow;

frame.postMessage(
  {
    channel: "replicad-studio",
    type: "loadScript",
    requestId: "1",
    code: "const main = () => replicad.makeBaseBox(10, 20, 30);",
  },
  "https://studio.example"
);

frame.postMessage(
  {
    channel: "replicad-studio",
    type: "setParams",
    requestId: "2",
    params: { height: 15 },
  },
  "https://studio.example"
);
```

Request `type` is one of `loadScript`, `setParams`, `clearParams`, `rebuild`,
`getState`. `loadScript` accepts `keepParams: true`.

The reply goes back to `event.source`:

```js
{
  channel: "replicad-studio",
  type: "response",
  requestId: "2",
  ok: true,
  state: { /* same shape as getState() */ }
}
```

Failures use `ok: false` and `error: { message }`.

By default any origin may send these messages, because the studio is a local
sandbox and a script that already runs in the page can do the same work. To
restrict it, set an allowlist before the app boots (or at any time; it is
read per message):

```js
window.replicadExternalOrigins = ["https://my-app.example"];
```

Include the studio page's own origin if same-page `postMessage` should keep
working. The JavaScript handle is not origin-checked.

## Notes for upstream

- Parameter values set through this API are stored on the workbench state and
  reused for the next rebuild. Opening a new script clears them.
- Share links and saved scripts are unchanged: only the script text is
  exported. This API does not add anything to the URL.
- Rapid rebuilds are serialized. A newer request replaces one that has not
  started yet, and every caller waits for the run that includes its change.
