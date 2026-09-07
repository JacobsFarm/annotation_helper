# Annotation Helper

A YOLO annotation tool: bounding boxes, segmentation polygons and model-assisted
labelling, with dataset tools and training in the same window.

<img width="1918" height="1027" alt="Schermafbeelding 2026-09-06 214810" src="https://github.com/user-attachments/assets/937eb61a-7033-46ff-a142-bc1e576837a4" />

An Electron + Svelte shell around a Python engine. The shell owns the canvas and the
files; Python owns the model and the dataset maths. Either half runs without the other:
you can annotate with no Python installed, and you can split, check and train a dataset
from a terminal with no window open.

```
annotation_helper/
├── frontend/      Electron shell + Svelte renderer   (the application)
├── backend/       Python package + CLI + AI sidecar  (the engine)
├── docs/          architecture, decisions, formats
└── package.json   the few commands you need day to day
```

## Annotating

Nothing is written until you say so. **Enter**, **Ctrl+S** or **Save** writes the label
file; the arrow keys only move. That matters most with automatic prediction on: you page
through images, look at what the model proposes, and only the ones you accept become
labels. An image you pass by stays "to do", and a prediction you never accepted leaves
nothing behind. Leaving work you did *by hand* behind says so in a message, because that
is the one case where moving on is likely a mistake.

| Tool | Key | |
|---|---|---|
| Select | `V` | Move, resize, drag vertices. Pull an edge midpoint out for a new point; right-click or double-click a point to delete it |
| Box | `B` | Drag a rectangle |
| Polygon | `P` | Click points, Enter or double-click closes |
| Smart select | `S` | Click an object, get the object — see below |
| Eraser | `G` | Drag over polygon points to delete them in bulk; `[` and `]` size it |
| Pan | `H` | Or the middle mouse button, from any tool |

Other keys: `→`/`←` next and previous image, `Space` moves the image to the recycle bin,
`N` saves it as a verified background (an empty label file is training data, not a gap),
`F` fits, `E` predicts, `1`–`9` pick a class and re-class the selection, `Ctrl+Z` undoes.
Settings lists them all.

### Boxes and masks, kept apart

A polygon flattens to its own bounding box for free; a box cannot become the mask it
never held. So the two halves of the work are not interchangeable, and the app keeps
them visibly apart: every image in the list is marked **Box**, **Seg** or **Both**, the
filters above it show one half at a time, and the Dataset screen counts them separately.

That matters at the split. **Annotations → Segmentation only** leaves out every image
without a mask, so a box-only image cannot quietly weaken a segmentation run.
**Detection: polygons as boxes** goes the other way and writes every polygon out as its
bounding box. Both act on the exported dataset; your label files are never rewritten.

Boxes and polygons in *one* file are the case to avoid: ultralytics decides per file, so
one box row among polygons is read as a two-point polygon and becomes a nonsense box
without any error. The health check flags it, as an error when the project segments.

### Smart select

Click a flower and get the flower. This is [SAM](https://segment-anything.com/) prompted
by clicks rather than a model trained on your classes, so it works on the first image of
a brand-new project — before a detection model of your own exists.

- **Left click** what the object is, again to grow it.
- **Right click** (or Alt+click) what it is *not*, and that part comes off.
- **Backspace** takes a click back, **Enter** keeps the mask, **Esc** throws it away.

Every click re-asks with the whole set of clicks, so a wrong mask is corrected by
pointing at what is wrong with it, never by starting over. The image embedding is cached
per image, so only the first click pays for the encoder.

A mask that falls apart into pieces — a plant the grass cuts up — becomes one polygon per
piece, all in the active class. A single ring around all of them would have to run
straight through the grass in between, and a YOLO label is one ring per line anyway.

The model is `mobile_sam.pt` by default; ultralytics downloads it once on first use, so
that first click needs a network. **Settings → Model for smart select** takes any
ultralytics name (`sam2.1_b.pt` is slower and sharper) or a path to a `.pt` file.

### Prediction

The **Predict** button runs your own model over the whole image, in one of three
pipelines (Settings): boxes, polygons, or detect-then-segment, which crops each detection
and segments the crop — the most useful of the three for small objects.

The switch under the button predicts automatically as soon as an image without labels
opens, which turns annotating into one review pass. Predicted shapes are marked as such,
can be removed in one click, and — like everything else — are only written when you save.

## Requirements

| | |
|---|---|
| Node | 20 or newer (`.nvmrc` pins 22; built and verified on 25.7.0) |
| Python | 3.10 or newer, only for prediction, smart select, health check, split and training |
| Compiler | none — there are no native Node modules, so `npm install` never compiles |

On Windows, Python is often present but not on `PATH`, and the `python` that *is* on
`PATH` is frequently the Microsoft Store stub. The app tries several candidates and keeps
the first that actually answers; if none do, set the interpreter under
**Settings → Python**, or set `ANNOTATION_HELPER_PYTHON`.

The `npm` scripts below are less forgiving — they call `python` directly. If it is not on
your `PATH`, run the backend commands with the full path to the interpreter, for example
`C:\ProgramData\anaconda3\python.exe -m pytest backend/tests -q`.

Prediction, smart select and training need `ultralytics` and `torch`. Settings installs
them into the app's own directory (CPU or CUDA), or the CUDA build ships with them.

## Getting started

```bash
npm run setup     # installs the frontend, then the backend in editable mode
npm run dev       # the app, with hot reload
```

Then **New project**, pick an empty folder, and drop your images into its `input/`
folder. Annotating one copies it into `images/` with its label in `labels/`, and puts the
original in `recycle/` — nothing is deleted until you empty that from Settings.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm run build` | Type-check and build (`frontend/out/`) |
| `npm run dist` | Build a Windows installer |
| `npm test` | Vitest (shared logic) + pytest (engine) |
| `npm run check` | `svelte-check` and `tsc`, no build |
| `npm run ah -- --help` | The Python CLI |

The end-to-end smoke test launches the real app and drives it over the DevTools
protocol. It needs a desktop session:

```bash
npm run build && npm --prefix frontend run test:e2e
```

## Working without the app

Every dataset operation the GUI offers exists first as a CLI command, and the GUI calls
the same code. A project folder is plain YOLO on disk, so other tools read it unchanged.

```bash
python -m annotation_helper init ./my-project --classes "leaf,stem,fruit"
python -m annotation_helper check           # orphans, bad rows, unknown class ids
python -m annotation_helper split --mode lists
python -m annotation_helper split --shapes segment   # only images that have a mask
python -m annotation_helper train --dry-run # prints the exact ultralytics command
```

## What a project looks like

```
my-project/
├── annotation.project.json   settings, classes, thresholds — all paths relative
├── classes.txt               one name per line
├── data.yaml                 ultralytics dataset descriptor (generated)
├── input/                    drop images here to annotate them
├── images/                   annotated images
├── labels/                   YOLO .txt, one per image
├── recycle/                  originals and deletions, until you empty it
├── dataset/                  train/val/test, written by `split`
└── .annotation-helper/       index cache and file journal — safe to delete
```

`docs/project-layout.md` describes each of these, including what an *empty* label file
means and why that matters.

## Documentation

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How the three processes fit together |
| [docs/decisions.md](docs/decisions.md) | The decisions taken up front, and why |
| [docs/label-format.md](docs/label-format.md) | The label format both implementations follow |
| [docs/project-layout.md](docs/project-layout.md) | What lives in a project folder |
| [docs/roadmap.md](docs/roadmap.md) | What is built, and what is next |
| [Readme.dev](Readme.dev) | The build blueprint this was written against |

## Licence

GNU Affero General Public License v3.0. See [LICENSE](LICENSE).

Prediction, smart select and training run on [ultralytics](https://github.com/ultralytics/ultralytics),
which is AGPL-3.0, and this program is built to use it — so the whole is distributed
under the same licence. In practice: use it for anything you like, including commercially,
but if you distribute a modified version, or run one as a network service, the people
using it are entitled to your source. Ultralytics also sells a commercial licence for
projects that cannot live with that, and it covers their code, not this program.

Everything else the app is built from — Electron, Svelte, Vite, zod — is MIT or
Apache-2.0, which AGPL-3.0 accommodates. Model weights carry their own terms: the
ultralytics YOLO and MobileSAM checkpoints are AGPL-3.0, and a checkpoint you bring
yourself is yours to check.

Your annotations and your dataset are your own. Nothing in this licence reaches them.
