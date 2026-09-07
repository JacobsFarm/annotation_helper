"""Command line entry point.

Every dataset operation the GUI offers is reachable here first. That is not a courtesy
feature: it means the same code runs in CI and in a terminal, and it means a broken
window never blocks the actual work.

    python -m annotation_helper init ./my-project
    python -m annotation_helper check
    python -m annotation_helper split --mode lists
    python -m annotation_helper train --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .dataset import health_check, refresh_index, split_dataset
from .project import Project, create_project, find_project


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "handler", None):
        parser.print_help()
        return 1
    try:
        return args.handler(args)
    except (FileNotFoundError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="annotation-helper",
        description="YOLO annotation engine: projects, labels, datasets, training.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command")

    p_init = sub.add_parser("init", help="create a project folder")
    p_init.add_argument("path", nargs="?", default=".", type=Path)
    p_init.add_argument("--name")
    p_init.add_argument("--task", choices=["detect", "segment", "both"], default="detect")
    p_init.add_argument("--classes", help="comma-separated class names")
    p_init.set_defaults(handler=_cmd_init)

    p_info = sub.add_parser("info", help="show project settings")
    _add_project_arg(p_info)
    p_info.set_defaults(handler=_cmd_info)

    p_scan = sub.add_parser("scan", help="rebuild the image index")
    _add_project_arg(p_scan)
    p_scan.set_defaults(handler=_cmd_scan)

    p_check = sub.add_parser("check", help="dataset health check")
    _add_project_arg(p_check)
    p_check.add_argument("--json", action="store_true", help="machine-readable output")
    p_check.add_argument(
        "--strict", action="store_true", help="exit non-zero when warnings are present"
    )
    p_check.set_defaults(handler=_cmd_check)

    p_split = sub.add_parser("split", help="write a train/val/test dataset")
    _add_project_arg(p_split)
    p_split.add_argument("--output", type=Path)
    p_split.add_argument("--mode", choices=["copy", "move", "lists"], default="copy")
    p_split.add_argument("--include-unlabelled", action="store_true")
    p_split.add_argument(
        "--shapes",
        choices=["any", "segment", "detect"],
        default="any",
        help="any: as annotated; segment: polygon-only images; detect: polygons as boxes",
    )
    p_split.add_argument("--train", type=float, help="override the train ratio")
    p_split.add_argument("--val", type=float)
    p_split.add_argument("--test", type=float)
    p_split.add_argument("--seed", type=int)
    p_split.set_defaults(handler=_cmd_split)

    p_yaml = sub.add_parser("export", help="write data.yaml and classes.txt")
    _add_project_arg(p_yaml)
    p_yaml.set_defaults(handler=_cmd_export)

    p_train = sub.add_parser("train", help="start an ultralytics training run")
    _add_project_arg(p_train)
    p_train.add_argument("--epochs", type=int)
    p_train.add_argument("--model")
    p_train.add_argument("--imgsz", type=int)
    p_train.add_argument("--batch", type=int)
    p_train.add_argument("--device")
    p_train.add_argument("--dry-run", action="store_true", help="print the command only")
    p_train.set_defaults(handler=_cmd_train)

    p_sidecar = sub.add_parser("sidecar", help="run the NDJSON server on stdin/stdout")
    p_sidecar.set_defaults(handler=_cmd_sidecar)

    return parser


def _add_project_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "-p",
        "--project",
        type=Path,
        default=None,
        help="project folder (default: search upwards from the current directory)",
    )


def _resolve(args) -> Project:
    if args.project:
        return Project.load(args.project)
    found = find_project(Path.cwd())
    if found is None:
        raise FileNotFoundError(
            "no annotation.project.json here or above; pass --project or run init"
        )
    return Project.load(found)


# --- commands ---------------------------------------------------------------


def _cmd_init(args) -> int:
    project = create_project(args.path, name=args.name, task=args.task)
    if args.classes:
        from .project import DEFAULT_CLASS_COLORS, ProjectClass

        names = [n.strip() for n in args.classes.split(",") if n.strip()]
        project.classes = [
            ProjectClass(i, name, DEFAULT_CLASS_COLORS[i % len(DEFAULT_CLASS_COLORS)])
            for i, name in enumerate(names)
        ]
        project.save()
    project.write_data_yaml()
    print(f"project ready: {project.root}")
    print(f"  images  {project.images_dir}")
    print(f"  labels  {project.labels_dir}")
    print(f"  classes {', '.join(project.class_names())}")
    return 0


def _cmd_info(args) -> int:
    project = _resolve(args)
    print(json.dumps({"root": str(project.root), **project.to_dict()}, indent=2))
    return 0


def _cmd_scan(args) -> int:
    project = _resolve(args)
    entries = refresh_index(project)
    labelled = sum(1 for e in entries if e.labelled)
    print(f"{len(entries)} images, {labelled} labelled, {len(entries) - labelled} to do")
    return 0


def _cmd_check(args) -> int:
    project = _resolve(args)
    report = health_check(project)

    if args.json:
        print(json.dumps(report.to_dict(), indent=2))
    else:
        print(f"images      {report.images}")
        print(f"labelled    {report.labelled}  (of which {report.backgrounds} background)")
        print(f"unlabelled  {report.unlabelled}")
        print(f"shapes      {report.shapes}  ({report.boxes} box, {report.polygons} polygon)")
        for class_id, count in sorted(report.per_class.items()):
            print(f"  {class_id:>3} {project.class_name(class_id):<20} {count}")
        if report.per_kind:
            kinds = "  ".join(f"{k} {v}" for k, v in sorted(report.per_kind.items()))
            print(f"per kind    {kinds}")
        if report.issues:
            print(f"\n{len(report.issues)} issue(s):")
            for issue in report.issues[:50]:
                print(f"  [{issue.level}] {issue.code}: {issue.file} {issue.detail}".rstrip())
            if len(report.issues) > 50:
                print(f"  ... and {len(report.issues) - 50} more")
        else:
            print("\nno issues")

    if report.errors:
        return 1
    return 1 if args.strict and report.issues else 0


def _cmd_split(args) -> int:
    project = _resolve(args)
    for field_name in ("train", "val", "test", "seed"):
        value = getattr(args, field_name, None)
        if value is not None:
            setattr(project.split, field_name, value)

    result = split_dataset(
        project,
        output=args.output,
        mode=args.mode,
        include_unlabelled=args.include_unlabelled,
        shapes=args.shapes,
    )
    print(f"train {result.train}  val {result.val}  test {result.test}  skipped {result.skipped}")
    if result.skipped_kind:
        print(f"left out    {result.skipped_kind} (no mask to learn from)")
    if result.converted:
        print(f"flattened   {result.converted} label file(s) to boxes")
    print(f"output: {result.output}")
    print(f"data.yaml: {project.root / 'data.yaml'}")
    return 0


def _cmd_export(args) -> int:
    project = _resolve(args)
    print(project.write_classes_txt())
    print(project.write_data_yaml())
    return 0


def _cmd_train(args) -> int:
    from .training.runner import TrainingManager, build_command

    project = _resolve(args)
    overrides = {
        key: getattr(args, key)
        for key in ("epochs", "model", "imgsz", "batch", "device")
        if getattr(args, key, None) is not None
    }

    command = build_command(project, overrides)
    print(" ".join(command))
    if args.dry_run:
        return 0

    data_yaml = project.root / "data.yaml"
    if not data_yaml.is_file():
        print("error: no data.yaml; run `split` or `export` first", file=sys.stderr)
        return 2

    manager = TrainingManager()
    run = manager.start(project, overrides, emit=lambda name, fields: _print_event(name, fields))
    assert run.process is not None
    return run.process.wait()


def _print_event(name: str, fields: dict) -> None:
    if name == "train_output":
        print(fields["line"])


def _cmd_sidecar(args) -> int:
    from .sidecar.server import main as serve

    return serve()
