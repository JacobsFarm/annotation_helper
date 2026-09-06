# A project folder

Everything about a project lives in its own folder, in formats other tools already read.
Copy the folder to another machine and it opens unchanged; delete the application and the
data is still a working YOLO dataset.

```
my-project/
├── annotation.project.json    settings, classes, thresholds
├── classes.txt                one class name per line, ordered by id
├── data.yaml                  ultralytics dataset descriptor (generated)
├── input/                     the inbox: drop images here to annotate them
├── images/                    annotated images, sub-folders allowed
├── labels/                    YOLO .txt, mirroring images/
├── recycle/                   originals and deletions; emptied only on request
├── dataset/                   train/val/test, written by `split`
└── .annotation-helper/        application state — safe to delete at any time
    ├── index.json             image index cache, invalidated on mtime
    └── journal.ndjson         every move and delete, for undo
```

## annotation.project.json

Every path in it is **relative to this folder**, which is what makes the project
portable. The application never stores an absolute path in it.

```jsonc
{
  "formatVersion": 1,
  "name": "Demo dataset",
  "task": "detect",                    // detect | segment | both
  "classes": [
    { "id": 0, "name": "leaf", "color": "#386938" }
  ],
  "paths": {
    "input": "input", "images": "images", "labels": "labels",
    "recycle": "recycle", "output": "dataset"
  },
  "ai": {
    "pipeline": "detect",              // detect | segment | detect_then_segment
    "detectModel": "",                 // absolute path to a .pt, or empty
    "segmentModel": "",
    "confidence": 0.25,
    "iou": 0.45,
    "maxDetections": 300,
    "expandRatio": 0.1,                // box growth before the crop, dual pipeline only
    "simplifyTolerance": 1.5           // pixels; 0 keeps every predicted vertex
  },
  "split": { "train": 0.8, "val": 0.15, "test": 0.05, "seed": 1337 },
  "training": {
    "model": "yolo11n.pt",
    "epochs": 100, "imgsz": 640, "batch": 16,
    "device": "",                      // "" lets ultralytics choose; "0" or "cpu"
    "patience": 50, "runName": "train"
  }
}
```

Unknown keys are ignored on read and every section has defaults, so a newer file opens in
an older build and a hand-written file may omit whatever it does not care about.

Editing it by hand is fine. The application rewrites it whenever a setting changes, and
regenerates `classes.txt` at the same time.

## classes.txt and data.yaml

Both are **generated**. `classes.txt` is refreshed on every project save; `data.yaml` is
written by `split`, by *Write data.yaml and classes.txt* on the Dataset screen, and by
`python -m annotation_helper export`.

`data.yaml` points `path:` at the split output directory, with forward slashes — a
Windows backslash in YAML is an escape sequence.

Editing either by hand works, but the next regeneration overwrites it. Change the project
file instead.

## input/, images/ and labels/

`input/` is the inbox. Copy the images you want to annotate into it — sub-folders and
all — and they appear at the top of the annotate screen, marked as new.

Saving a label is what takes an image out of the inbox. It is **copied** into `images/`,
keeping whatever sub-folder it was in, the label is written to `labels/`, and the
original is moved to `recycle/` rather than dropped. So `images/` and `labels/` only ever
contain work that has been through the annotator, what is left in `input/` is exactly
what is left to do, and the file the scanner or the camera produced is still on disk
until you say otherwise.

Both steps are journalled like every other file operation, so both are undoable, and the
target name is uniqued *before* the label is written: an image whose name is already
taken in `images/` becomes `name (2).jpg` and gets `name (2).txt` beside it. The pair
cannot come apart.

A relative path present in both `input/` and `images/` — only possible by filling the
folders by hand — is listed once, from `images/`, since that is the copy the label
belongs to. Rename the one in `input/` to get it back.

Sub-folders are allowed and preserved: `images/batch1/a.jpg` gets `labels/batch1/a.txt`.
Recognised extensions are `.jpg .jpeg .png .bmp .webp .tif .tiff`.

The image list is sorted, case-insensitively and numerically, so "next image" means the
same thing on every machine and after every rescan.

Nothing outside this application cares about `input/`. `split`, `data.yaml` and every
health check read `images/` and `labels/`, which is a plain ultralytics dataset with or
without an inbox beside it.

See [label-format.md](label-format.md) for the contents, and in particular for why an
empty label file is not the same as a missing one.

## dataset/

Written by `split`, in one of three modes:

| Mode | Effect |
|---|---|
| `copy` | Duplicates images and labels into `dataset/<split>/images|labels` |
| `move` | Same layout, but empties the source folder |
| `lists` | Writes `train.txt` / `val.txt` / `test.txt` of absolute paths and touches no image |

`lists` is the cheapest for large datasets and the safest while you are still annotating.

Splits are reproducible: same seed, same dataset, same partition. Counts are apportioned
by largest remainder, so a small dataset at 80/15/5 gets 5/1/0 rather than the 4/0/2 that
naive flooring produces.

## .annotation-helper/

Application state, never data. It carries its own `.gitignore` (`*`), and deleting the
whole folder loses nothing except an index cache and the ability to undo file operations
from before the deletion.

The bin used to live in here. It is now `recycle/`, below, because what is in it is data
rather than state.

## recycle/

Two things land here:

| What | When |
|---|---|
| `recycle/images/` | the original of an annotated image, and any image you delete |
| `recycle/labels/` | the label of a deleted image |

A visible folder next to `images/`, not something hidden inside `.annotation-helper/`,
because what is in it is your data and you have to be able to see it. Names are uniqued
on the way in, so nothing in the bin ever overwrites anything else in it, and every move
into it is journalled — undo takes it straight back out.

Nothing in this application calls `unlink` on user data except one action: **Settings →
Recycle bin → Empty permanently**. It says how many files it is about to take and asks
first. Emptying also drops the journal entries that pointed into the bin, so undo reports
honestly that those are gone rather than silently doing nothing.
