# A project folder

Everything about a project lives in its own folder, in formats other tools already read.
Copy the folder to another machine and it opens unchanged; delete the application and the
data is still a working YOLO dataset.

```
my-project/
├── annotation.project.json    settings, classes, thresholds
├── classes.txt                one class name per line, ordered by id
├── data.yaml                  ultralytics dataset descriptor (generated)
├── images/                    your images, sub-folders allowed
├── labels/                    YOLO .txt, mirroring images/
├── dataset/                   train/val/test, written by `split`
└── .annotation-helper/        application state — safe to delete at any time
    ├── index.json             image index cache, invalidated on mtime
    ├── journal.ndjson         every move and delete, for undo
    └── trash/                 what "delete" actually does
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
  "paths": { "images": "images", "labels": "labels", "output": "dataset" },
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

## images/ and labels/

Sub-folders are allowed and preserved: `images/batch1/a.jpg` gets `labels/batch1/a.txt`.
Recognised extensions are `.jpg .jpeg .png .bmp .webp .tif .tiff`.

The image list is sorted, case-insensitively and numerically, so "next image" means the
same thing on every machine and after every rescan.

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

`trash/` is where deleted images and labels go. Nothing in this application calls
`unlink` on user data; emptying the trash is a manual act in the file explorer.
