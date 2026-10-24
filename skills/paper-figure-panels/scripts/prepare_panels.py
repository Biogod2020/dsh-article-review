"""Crop, preview and prepare exact DSH registration from a packet and short target IDs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re

from split_panels import inside, split
from inspect_figure import inspect


def read_json(root, value, limit=2 * 1024 * 1024):
    path = inside(root, value)
    if path.suffix.lower() != ".json" or not path.is_file() or path.stat().st_size > limit:
        raise ValueError("Use a workspace JSON file no larger than 2 MiB")
    return json.loads(path.read_text(encoding="utf-8"))


def exclusive_json(path, value):
    content = (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
    if len(content) > 1024 * 1024:
        raise ValueError("Registration exceeds the host's 1 MiB limit; reduce the figure's target set")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as handle:
            handle.write(content)
    except FileExistsError:
        if path.read_bytes() != content:
            raise ValueError("Output already contains different data; use a new round's filename")


def current_packet(root, packet_file):
    """Bind exported context to its original workspace, even if a copy has identical bytes."""
    packet = read_json(root, packet_file)
    if not isinstance(packet, dict) or packet.get("version") != 1:
        raise ValueError("Export a current panel packet with paper_figure_list first")
    workspace = packet.get("workspaceRoot")
    if workspace is not None and (not isinstance(workspace, str) or not Path(workspace).is_absolute()
                                  or Path(workspace).resolve() != root):
        raise ValueError("Packet belongs to a different workspace; use the target workspace and export fresh context")
    if hashlib.sha256(inside(root, packet["path"]).read_bytes()).hexdigest() != packet["revision"]:
        raise ValueError("Manuscript changed; export a fresh packet and reread affected paragraphs")
    return packet


def packet_blocks(root, packet_file, query):
    """Search only the manuscript snapshot, returning exact blocks instead of the full packet."""
    root = Path(root).resolve(strict=True)
    packet = current_packet(root, packet_file)
    pattern = re.compile(query, re.IGNORECASE)
    matches = [{"index": index, **block} for index, block in enumerate(packet["blocks"])
               if pattern.search(block["text"])]
    return {"workspaceRoot": str(root), "path": packet["path"], "revision": packet["revision"], "matches": len(matches), "blocks": matches}


def prepare(root, packet_file, manifest_file, targets_file, output_file):
    root = Path(root).resolve(strict=True)
    packet = current_packet(root, packet_file)
    spec = read_json(root, manifest_file)
    selected = read_json(root, targets_file)
    manuscript = inside(root, packet["path"])
    source = inside(root, spec["source"])
    if hashlib.sha256(source.read_bytes()).hexdigest() != spec["sourceHash"]:
        raise ValueError("Source hash changed; inspect the current artwork")
    figures = [figure for figure in packet["figures"]
               if figure.get("file") and inside(root, figure["file"]) == source
               and figure.get("sourceHash") == spec["sourceHash"]
               and (not spec.get("figureBlockId") or figure["blockId"] == spec["figureBlockId"])]
    if len(figures) != 1:
        raise ValueError("Choose one packet figure with matching source/hash; specify figureBlockId if reused")
    figure = figures[0]
    blocks = {block["id"]: block for block in packet["blocks"]}
    if len(blocks) != len(packet["blocks"]):
        raise ValueError("Packet contains duplicate block IDs")
    labels = [panel["label"] for panel in spec["panels"]]
    if not isinstance(selected, dict) or set(selected) != set(labels):
        raise ValueError("Targets must map every candidate panel label to a list of exact block IDs")
    targets = {}
    for label in labels:
        ids = selected[label]
        if (not isinstance(ids, list) or not 1 <= len(ids) <= 100
                or any(not isinstance(value, str) for value in ids) or len(set(ids)) != len(ids)):
            raise ValueError("Each panel needs 1 to 100 distinct target block IDs; omit unresolved panels")
        if any(not isinstance(value, str) or value not in blocks for value in ids):
            raise ValueError("Unknown target ID; copy IDs from the current packet or paper_read")
        if any(not isinstance(blocks[value].get("text"), str) or not blocks[value]["text"] for value in ids):
            raise ValueError("Target blocks must contain exact nonempty text")
        targets[label] = [{"blockId": value, "before": blocks[value]["text"]} for value in ids]
    output = inside(root, output_file)
    protected = {manuscript, source, *(inside(root, p) for p in [packet_file, manifest_file, targets_file])}
    if output.suffix.lower() != ".json" or output in protected:
        raise ValueError("Choose a new workspace .json registration output")
    # Keep generated assets with the manuscript even when the conversation workspace is HOME.
    crop_dir = (manuscript.parent / "figures/reader-panels").relative_to(root).as_posix()
    crops = split(root, inside(root, manifest_file), crop_dir)
    result = {"workspaceRoot": str(root), "path": packet["path"], "revision": packet["revision"], "figureBlockId": figure["blockId"],
              "figure": figure["path"], "sourceHash": spec["sourceHash"],
              "panels": [{key: crop[key] for key in ["label", "file", "page", "region"]}
                         | {"targets": targets[crop["label"]]} for crop in crops]}
    previews = inspect(root, inside(root, manifest_file),
                       output_dir=(output.parent / (output.stem + "-previews")).relative_to(root).as_posix())
    # Detect source edits during rendering; an old packet must never silently become a new map.
    if (hashlib.sha256(manuscript.read_bytes()).hexdigest() != packet["revision"]
            or hashlib.sha256(source.read_bytes()).hexdigest() != spec["sourceHash"]):
        raise ValueError("Source changed during preparation; export a fresh packet")
    exclusive_json(output, result)
    return {"workspaceRoot": str(root), "path": packet["path"], "revision": packet["revision"],
            "manifest": output.relative_to(root).as_posix(), "figureBlockId": figure["blockId"],
            "panelCount": len(crops), "targetCount": sum(len(value) for value in targets.values()),
            "panels": crops, "previews": previews,
            "next": "Inspect the contact sheets/crops, then paper_panel_set(path=packet.path, manifest=this manifest)."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace")
    parser.add_argument("packet")
    parser.add_argument("manifest", nargs="?")
    parser.add_argument("targets", nargs="?")
    parser.add_argument("--output")
    parser.add_argument("--query", help="Read-only regex search over current packet blocks; omit crop arguments")
    args = parser.parse_args()
    if args.query is not None:
        if args.manifest or args.targets or args.output:
            parser.error("Use --query or crop arguments, not both")
        result = packet_blocks(args.workspace, args.packet, args.query)
    else:
        if not (args.manifest and args.targets and args.output):
            parser.error("Cropping requires MANIFEST TARGETS --output REGISTRATION.json")
        result = prepare(args.workspace, args.packet, args.manifest, args.targets, args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))
