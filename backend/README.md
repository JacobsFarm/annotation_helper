# Annotation Helper - backend

The engine. Everything here runs without Electron, without a window and without npm:

```bash
python -m annotation_helper --help
```

| Module | Responsibility |
|---|---|
| `shapes.py` | The one shape model (box + polygon), image-pixel coordinates |
| `labels.py` | The only place that normalises to / from YOLO's 0-1 range |
| `project.py` | `annotation.project.json`, `classes.txt`, `data.yaml` |
| `dataset.py` | Scan, health check, train/val/test split |
| `fileops.py` | Journalled moves + trash. Nothing is ever hard-deleted |
| `sidecar/` | NDJSON-over-stdio server the Electron app talks to |
| `training/` | Builds and launches ultralytics training runs |

Only `sidecar/predictor.py` and `training/` import `ultralytics`, and they import it lazily,
so the core stays usable in a bare Python install.

## Install

```bash
python -m pip install -e ".[dev]"      # core + tests
python -m pip install -e ".[ai,dev]"   # + ultralytics for predict/train
```

## Tests

```bash
python -m pytest -q
```
