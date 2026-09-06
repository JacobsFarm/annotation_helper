# Architecture

Three processes, two languages, one contract.

```
┌──────────────────────────────┐
│ renderer  (Svelte 5, runes)  │  draws, edits, holds UI state
│   lib/canvas   lib/state     │
└───────────▲──────────────────┘
            │ window.bridge — one channel, one envelope
┌───────────┴──────────────────┐
│ main  (Node, Electron)       │  files, dialogs, the ah-img:// protocol
│   ipc/  →  services/         │
└───────────▲──────────────────┘
            │ NDJSON over stdin/stdout
┌───────────┴──────────────────┐
│ sidecar  (Python)            │  ultralytics, dataset maths, training
│   sidecar/  dataset  labels  │
└──────────────────────────────┘
```

## The thin-IPC rule

```
frontend/src/main/ipc/*.ipc.ts       a handler is: unwrap args, call a service, return
frontend/src/main/services/*.ts      all the logic; imports nothing from Electron's UI
backend/.../sidecar/server.py        the same rule on the Python side
```

Everything testable ends up in `services/` (plain Node) or the Python package (plain
Python), so the whole application is unit-testable without launching a window.

## The envelope

Electron turns a rejected `invoke` into the opaque string *"Error invoking remote
method"*. So every handler returns

```ts
{ ok: true, data } | { ok: false, error: { code, message, detail } }
```

and **never rejects**. The preload hands that envelope through unchanged — Electron's
context bridge strips custom fields off a thrown `Error`, so throwing there would lose
the code — and `renderer/src/lib/api` turns it back into a real `ApiError`. Call sites
use `safeCall(...)`, which catches, raises a toast and returns `null`. No error can be
silently swallowed.

## Codes, not sentences

The main process and the sidecar have no locale. Anything a human will read crosses the
boundary as a code (`path_outside_project`, `model_not_found`, `orphan_label`) and is
translated in `renderer/src/lib/i18n`. `errorMessage()` and `issueMessage()` are the only
two functions that do this.

## Images do not travel over IPC

`ah-img://f/<url-encoded absolute path>` serves files from opened project roots only,
with a containment check on every request. The renderer uses a plain `<img>`, so
Chromium handles decoding, caching and GPU upload.

The CSP allows `ah-img:` under `img-src` and deliberately **not** under `connect-src`:
the protocol exists to display images, not to give page scripts a file-reading channel.

## Coordinate spaces

`shared/geometry.ts` owns every conversion, and the two spaces are branded types that
cannot be passed for one another:

```ts
type ImagePoint  = { x, y } & brand<'image'>    // what is stored and saved
type ScreenPoint = { x, y } & brand<'screen'>   // what a pointer event gives
```

Coordinates are image pixels everywhere in memory. Normalisation to YOLO's 0-1 range
happens in exactly one place, at write time, in `label-io`. One `Viewport` object owns
`scale` and `offset`; no layer recomputes either. Shapes are drawn in an SVG that uses
image pixels directly, under one CSS transform, so there is no second scaling path to
disagree with the first.

## Tools

Every tool implements one interface (`onPointerDown/Move/Up`, `cancel`) and receives an
already-converted image-space point. Adding a keypoint or polyline tool later is a new
file in `lib/canvas/tools/`, not a new tab.

## State

One rune store per concern, at module level in `lib/state/*.svelte.ts`:

```
project  dataset  annotations  viewport  tool  ai  training  settings  toast  nav
```

Module level, not component level, so state outlives the component tree. That is what
lets the language switch re-render the whole UI without a reload, and therefore without
discarding the open project or unsaved work.

## Two undo stacks

| | Scope | Where |
|---|---|---|
| Shape undo | Edits on the open image | `lib/state/annotations.svelte.ts`, in memory |
| File journal | Moves, deletes | `main/services/file-ops.ts`, NDJSON on disk |

A drag pushes one history entry when it starts, not one per pointer move. Nothing is
ever hard-deleted: `delete` moves into `.annotation-helper/trash/`, journalled, and the
journal replays backwards.

## The sidecar

Newline-delimited JSON over stdio. Not HTTP: no port to collide with, no localhost
surface to secure, and the process dies with its parent.

```
--> {"id":"7","method":"predict","params":{"image":"…","pipeline":"detect_then_segment"}}
<-- {"event":"progress","id":"7","stage":"detect","pct":40}
<-- {"id":"7","ok":true,"result":{"shapes":[…],"ms":312}}
```

`main` tries interpreter candidates in order and keeps the first whose sidecar sends its
`ready` frame — a Windows Store stub that spawns and exits is skipped rather than
mistaken for a working Python. Models load lazily on first predict and stay warm; a
crash restarts the process with bounded retries and rejects the pending calls rather
than leaving them hanging.

Training is a *subprocess of the sidecar*, not code inside it: a torch process that
hangs or runs out of memory cannot take prediction down with it, cancelling is a kill
that always works, and the exact command is printable so it can be pasted into a shell.
