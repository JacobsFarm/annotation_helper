# Roadmap

## Built and verified

| | |
|---|---|
| Canvas | Zoom, pan, fit, actual size; verified on a 4K image scaled into a small window |
| Box tool | Draw, select, move, resize from eight handles |
| Polygon tool | Click to place, drag vertices, alt-click an edge to insert, alt-click a vertex to remove |
| Label I/O | Round-trip tested on both sides, boxes and polygons, edge coordinates included |
| Negative samples | *Mark as background* writes an empty label file deliberately |
| Projects | Create, open, recent list, class editor, per-project thresholds |
| Dataset | Scan with a JSON index, health check, reproducible split, `data.yaml` export |
| Prediction | Three pipelines, progress events, cancellation, lazy model loading |
| Training | Command preview, start, live log, epoch progress, cancel |
| Files | Journalled trash and undo; nothing is hard-deleted |
| i18n | English and Dutch, switchable without a reload |
| Themes | Light and dark, or follow the system |
| Tests | 54 pytest, 23 vitest, 16 end-to-end checks against the running app |

## Next, roughly in order of value

### 1. Review screen

Multi-select over a thumbnail grid, then approve, reject or re-class in one action. The
predecessor was strictly one image at a time, and reviewing a model's output is where
most of the time goes.

### 2. Auto-save and crash recovery

Losing work to a crash is not acceptable. Periodic write of the in-progress annotation to
a scratch file in `.annotation-helper/`, and an offer to recover it on next launch.
Auto-save on navigation already exists; this is about the gap between saves.

### 3. Prediction prefetch

While the user annotates image *n*, predict *n+1* into a small LRU cache. The single
largest perceived-speed win available. The queue and its invalidation should be designed
before it is written — bolting cancellation onto a synchronous predict call afterwards is
painful, which is why the cooperative cancel already exists.

### 4. Per-model class mapping

`_map_class` in `predictor.py` is currently identity. A model trained on COCO predicts
class 2 for "car" whether or not class 2 in your project means anything similar. The
mapping table belongs in the project file, and that function is the single seam it plugs
into.

### 5. A real application menu

With shortcuts shown next to the actions, so they are discoverable. The Settings screen
lists them, which is a stopgap.

### 6. Configurable shortcuts

Capture the actual `KeyboardEvent` rather than letting anyone type key names, scope the
map per screen so the same key can mean different things, and flag duplicates within a
scope.

### 7. PyInstaller-frozen sidecar

Removes "install Python" from the setup instructions. Touches `python-service.ts` (where
to find the executable) and `electron-builder.yml` (what to ship).

### 8. Bundle budget

The renderer is 412 kB with everything wired up. Code-split the canvas engine before it
doubles.

## Known limits

- **Shapes are SVG.** Above a few hundred shapes on one image, rendering will be the
  bottleneck. `ShapeLayer` is replaceable without touching the tools.
- **The index is JSON.** Good to roughly 100k images. Past that, revisit SQLite and
  accept the native-module cost.
- **No file watcher.** Editing a label in another program while its image is open here
  will lose that edit on save. Locked in as an assumption; see `docs/decisions.md`.
- **`detect_then_segment` keeps one mask per detection.** The largest one. A detection
  that genuinely contains two objects will lose one of them.
- **Training parses ultralytics' stdout** for epoch progress. A change in its output
  format breaks the progress bar, not the run.
