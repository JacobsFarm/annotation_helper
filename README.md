# Annotation Helper

A YOLO annotation tool: bounding boxes, segmentation polygons and model-assisted
labelling, with dataset tools and training in the same window.

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

## Requirements

| | |
|---|---|
| Node | 20 or newer (`.nvmrc` pins 22; built and verified on 25.7.0) |
| Python | 3.10 or newer, only for prediction, health check, split and training |
| Compiler | none — there are no native Node modules, so `npm install` never compiles |

On Windows, Python is often present but not on `PATH`, and the `python` that *is* on
`PATH` is frequently the Microsoft Store stub. The app tries several candidates and keeps
the first that actually answers; if none do, set the interpreter under
**Settings → Python**, or set `ANNOTATION_HELPER_PYTHON`.

The `npm` scripts below are less forgiving — they call `python` directly. If it is not on
your `PATH`, run the backend commands with the full path to the interpreter, for example
`C:\ProgramData\anaconda3\python.exe -m pytest backend/tests -q`.

## Getting started

```bash
npm run setup     # installs the frontend, then the backend in editable mode
npm run dev       # the app, with hot reload
```

Then **New project**, pick an empty folder, and drop your images into its `images/`
folder.

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
python -m annotation_helper train --dry-run # prints the exact ultralytics command
```

## What a project looks like

```
my-project/
├── annotation.project.json   settings, classes, thresholds — all paths relative
├── classes.txt               one name per line
├── data.yaml                 ultralytics dataset descriptor (generated)
├── images/                   your images
├── labels/                   YOLO .txt, one per image
├── dataset/                  train/val/test, written by `split`
└── .annotation-helper/       index cache, file journal, trash — safe to delete
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

MIT. See [LICENSE](LICENSE).
