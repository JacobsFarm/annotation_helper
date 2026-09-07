# Label format

The specification both implementations follow:

- `frontend/src/shared/label-io.ts` (TypeScript, used while annotating)
- `backend/src/annotation_helper/labels.py` (Python, used by the CLI and the sidecar)

They exist separately so annotating works without Python; this file is what stops them
drifting. Changing anything here means changing both, and both test suites.

## On disk

One `.txt` per image, same stem, under the project's `labels/` directory, mirroring any
sub-folder structure:

```
images/batch1/img_001.jpg  →  labels/batch1/img_001.txt
```

## Rows

Whitespace-separated. All coordinates are normalised to `0-1` against the image's own
width and height.

### Box — 5 values

```
<class> <cx> <cy> <w> <h>
```

Centre, width and height. This is the standard ultralytics detection row.

### Polygon — an odd number of values, at least 7

```
<class> <x1> <y1> <x2> <y2> <x3> <y3> ...
```

At least three points. The first point is **not** repeated at the end; the polygon is
implicitly closed. This is the standard ultralytics segmentation row.

Both kinds may appear in the same file. Which one a row is, is decided by how many
values follow the class id: four means a box, six or more (and even) means a polygon.

### Comments and blank lines

Lines that are empty or begin with `#` are skipped on read. Nothing writes them, but
hand-edited files stay readable.

## Precision

Six decimals, fixed (`0.500000`, never `0.5`). At 8K that is about 0.004 px of error, and
it makes a written file byte-identical between the two implementations.

## Empty files

An **existing but empty** label file means *verified background*: someone looked at this
image and confirmed there is nothing to annotate. That is training data.

A **missing** label file means *not looked at yet*.

The distinction is deliberate and is the only thing that makes negative samples
expressible. In memory it is carried by `ImageAnnotation.reviewed`:

| `reviewed` | shapes | meaning |
|---|---|---|
| `false` | 0 | not annotated yet |
| `true` | 0 | verified background |
| `true` | n | annotated |

## Annotation kinds

Which rows a file holds decides which task the image can train, and the two directions
are not equal:

| Kind | Rows | Trains detection | Trains segmentation |
|---|---|---|---|
| `box` | boxes only | yes | **no** |
| `polygon` | polygons only | yes, via their bounding boxes | yes |
| `mixed` | both | yes | **no — and it corrupts the run** |
| `background` | none, file exists | yes | yes |
| `none` | no file | not part of the dataset | not part of the dataset |

A polygon flattens to its own bounding box for free. A box cannot become the mask it
never held, so the conversion only ever runs one way.

`mixed` is the one that has to be avoided rather than merely noted. Ultralytics decides
per *file*: if any row has more than six values it reads every row in that file as a
polygon, so a five-token box row is reshaped into a two-point polygon and comes out as a
nonsense box. Nothing raises; the run is simply worse. The health check reports
`mixed_shape_kinds` — a warning in a detection project, an error in a segmentation one —
and `box_only_image` when a segmentation project holds an image that can never train a
mask.

The kind is derived, never stored: it is a function of the rows plus whether the file
exists. `annotation_kind()` in Python and `annotationKind()` in TypeScript compute it,
and both are covered by the same test cases.

Conversion happens on export and never in `labels/`. `split --shapes detect` writes each
polygon out as its bounding box into the split's own label files; `--shapes segment`
leaves out every image without a mask. The annotation on disk stays the richest form of
the work.

## Reading is forgiving, writing is strict

A malformed row never raises. It produces an issue and is skipped, so one bad line
cannot make a whole dataset unopenable. Issue codes:

| Code | Meaning |
|---|---|
| `malformed_row` | A value is not a number |
| `negative_class_id` | Class id below zero |
| `degenerate_box` | Width or height is zero or negative |
| `unexpected_token_count` | Not 5 tokens, and not an odd count of 7 or more |
| `coordinate_out_of_range` | A value outside `0-1` (tolerance 0.001) — flagged, shape kept |
| `bad_image_size` | The image reported a non-positive dimension |

Out-of-range coordinates are flagged but the shape is **kept**. Discarding data is worse
than warning about it.

Writing clamps to `0-1`, orders box corners top-left first whichever way the box was
dragged, and drops shapes that cannot be represented (a zero-area box, a polygon with
fewer than three points).

## Guarantees

Both implementations are tested for these:

1. `Shape[] → text → Shape[]` is lossless within float tolerance, for boxes and polygons,
   including coordinates that sit exactly on the image edge.
2. Writing twice produces byte-identical files.
3. A polygon keeps its class id. (The predecessor wrote every polygon as class 0; both
   suites guard against that regression by name.)
4. Boxes and polygons survive in the same file, in order.
5. An empty shape list writes an empty file, not a missing one.
6. Flattening polygons to boxes changes nothing already written as a box, and running it
   twice changes nothing at all.

## Class ids

Ids are positional: `nc` and `names` in `data.yaml` are indexed by id, so `classes.txt`
line *n* is class *n*.

Removing a class from a project therefore does **not** renumber the others — shifting ids
would silently re-label every existing file. A gap in the numbering is harmless and is
filled with `class_<n>` when the descriptor is generated.
