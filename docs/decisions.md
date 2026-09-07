# Decisions

`Readme.dev` §12 lists six things that are cheap to decide on day one and expensive
later. These are the answers, plus the places this build deliberately diverges from the
blueprint.

## The six

### 1. Comments in code

**Full explanatory comments, sparingly placed.** Every non-obvious decision carries the
reason it was made, and nothing explains what the code already says. Module docstrings
state what the module is responsible for and what it must never do.

The test: if deleting a comment would make someone re-derive a decision from scratch, it
stays.

### 2. UI language

**English is the base locale; Dutch ships alongside it from the first screen.** The
default at first launch is Dutch, changeable in Settings.

`messages/en.ts` is the source of truth. `nl.ts` is typed `Record<keyof typeof en, string>`,
so a missing or extra key fails `svelte-check` rather than showing up as a blank label
three screens deep.

### 3. Python distribution

**Bring your own interpreter, for now.** The app searches an explicit setting, then
`ANNOTATION_HELPER_PYTHON`, then `PATH`, then the usual Windows install locations, and
keeps the first candidate whose sidecar actually answers.

Freezing the sidecar with PyInstaller is the plan before anyone outside the team uses
it; the switch touches `python-service.ts` and `electron-builder.yml` only.

### 4. Licence

**AGPL-3.0-only.** This replaces the original MIT, and the reason it changed is the
interesting part.

MIT was chosen on the premise that `ultralytics` was an optional extra: imported lazily,
never bundled, so the repository distributed no AGPL code and inherited no copyleft. That
premise no longer holds. Settings installs ultralytics and torch into the app's own
directory, the CUDA build ships them inside the installer, and the model-assisted half of
the app — predict, automatic prediction, smart select, training — is built to use it
rather than to work without it. A build that carries AGPL code and is designed around it
is a combined work, so the whole goes out under the same licence.

What stays true: the Electron/Svelte/Vite/zod side is MIT or Apache-2.0 and sits happily
under AGPL-3.0, manual annotation still runs with no Python at all, and the licence
reaches the program, never the datasets people make with it.

### 5. Target dataset size

**Up to about 100,000 images**, which sets the index decision: a JSON index in
`.annotation-helper/index.json`, invalidated per entry on mtime and size. SQLite would be
faster and queryable, but `better-sqlite3` is a native module and would mean a C++
toolchain for anyone running `npm install`. Revisit only when a real dataset outgrows it.

### 6. External edits while the app is open

**Not supported, and the assumption is locked in.** There is no file watcher and no
conflict handling. Labels are read from disk on every image load, so re-opening an image
always shows what is actually stored; but if you edit a label in another program while
its image is open here, saving overwrites it.

## Where this build diverges from the blueprint

### i18n without Paraglide

The blueprint calls for Paraglide with per-page message files and a merge script. This
build uses a plain typed catalogue instead — two `.ts` files and a `t()` function reading
a rune.

What Paraglide was chosen for is preserved: a missing key is a build error, switching
locale re-renders without a reload, and there is no UI copy in `shared/` or `main/`. What
is given up: no per-page file splitting, no generated code, one fewer build step. At the
current size (roughly 200 keys) the merge-and-validate pipeline would be more machinery
than the problem needs. If the catalogue outgrows one file, split it per screen — the key
prefixes (`annotate_`, `dataset_`, …) already partition cleanly.

### Label I/O exists twice, on purpose

`shared/label-io.ts` and `backend/.../labels.py` implement the same format. This is
duplication with a reason: annotating must work when Python is missing or misconfigured,
and if the parser lived only in the sidecar, "Python not configured" would be a wall
rather than a warning.

The cost is drift. Two things hold the pair together: `docs/label-format.md` is the
specification both implement, and both sides run the same round-trip cases
(`frontend/src/shared/label-io.test.ts`, `backend/tests/test_labels.py`), including one
assertion on the exact bytes written for a known box.

### Shapes are SVG, not a 2D canvas

Shapes are drawn as SVG elements in image-pixel coordinates under one CSS transform.
This removes an entire class of bug — there is no second scaling path to disagree with
the first — at the cost of throughput above a few hundred shapes per image. The `Tool`
interface does not know how shapes are rendered, so swapping `ShapeLayer` for a canvas
is a contained change if a real dataset needs it.

### Build order

The blueprint's step 5 says introduce projects and settings *after* the canvas works.
This build did the canvas, the tools and label I/O first, then projects, which is the
recommended order. The one thing built out of order is the class editor, because with no
way to add a class the box tool can only ever draw class 0 — which is the exact bug the
predecessor shipped.

## Standing rules

These are not preferences; breaking one is a bug.

1. Coordinates are image pixels in memory. Normalisation happens only in `label-io`.
2. No user-visible string literal in a component. No UI copy in `shared/` or `main/`.
3. No handler rejects. Everything returns the envelope.
4. Nothing is `unlink`ed. Deleting means moving to the project trash, journalled.
5. A label file is read before it is written. It is never treated as write-only.
6. An empty label file means "verified background" and is written on purpose.
7. Every threshold is a project setting. No confidence value is hardcoded anywhere.
