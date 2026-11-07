#!/usr/bin/env python3
"""Match curated transports and generated stairs to LostCity map placements.

Add locId, locX/locZ (the clickable tile), debugName and options, and resolve
locName. NPC transports keep their original fields. Run last in
derive-transports.sh so earlier generators do not overwrite the enrichment."""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

def selected_revision() -> int:
    revision = os.environ.get("REVISION")
    if revision is None:
        client_prot = Path(__file__).resolve().parents[2] / "src" / "client" / "io" / "ClientProt.ts"
        match = re.search(r"export const CLIENT_VERSION = (\d+);", client_prot.read_text(encoding="utf-8"))
        if not match:
            raise RuntimeError(f"Cannot read CLIENT_VERSION from {client_prot}")
        revision = match.group(1)
    try:
        selected = int(revision)
    except ValueError as error:
        raise RuntimeError(f"Invalid REVISION '{revision}'") from error
    if selected not in {289, 377}:
        raise RuntimeError(f"Unsupported nav revision {selected}")
    return selected


def load_stair_prices() -> dict:
    path = Path(os.environ.get("NAV_DATA_ROOT", ".")) / "tools/nav/stair-prices.json"
    table = json.loads(path.read_text(encoding="utf-8"))
    if table.get("schemaVersion") != 1 or table.get("baseTicks") != 1 or not isinstance(table.get("handlers"), dict):
        raise RuntimeError(f"Invalid {path} schema")
    for name, price in table["handlers"].items():
        if not name or not isinstance(price, dict):
            raise RuntimeError(f"Invalid stair price for handler '{name}'")
        has_default = "extraTicks" in price or "source" in price
        if has_default and (
            type(price.get("extraTicks")) is not int
            or price["extraTicks"] < 0
            or not isinstance(price.get("source"), str)
            or not price["source"]
        ):
            raise RuntimeError(f"Invalid stair price for handler '{name}'")
        if not has_default and not price.get("opPrices"):
            raise RuntimeError(f"Handler '{name}' has no default or op-specific stair price")
        op_prices = price.get("opPrices")
        if op_prices is not None:
            if not isinstance(op_prices, dict) or not op_prices:
                raise RuntimeError(f"Invalid op-specific stair prices for handler '{name}'")
            for op, op_price in op_prices.items():
                if (
                    not op.isdigit()
                    or not 1 <= int(op) <= 5
                    or not isinstance(op_price, dict)
                    or type(op_price.get("extraTicks")) is not int
                    or op_price["extraTicks"] < 0
                    or not isinstance(op_price.get("source"), str)
                    or not op_price["source"]
                ):
                    raise RuntimeError(f"Invalid op-specific stair price for handler '{name}' option {op}")
    return table["handlers"]


def extra_ticks(prices: dict | None, debug_name: str, op: int | None = None) -> int | None:
    if prices is None:
        return None
    price = prices.get(debug_name)
    if price is None:
        raise RuntimeError(f"Unpriced movement handler '{debug_name}'")
    op_prices = price.get("opPrices")
    if op_prices is not None:
        selected = op_prices.get(str(op)) if op is not None else None
        if selected is None:
            raise RuntimeError(f"Unpriced movement handler '{debug_name}' option {op}")
        return selected["extraTicks"]
    if "extraTicks" not in price:
        raise RuntimeError(f"Unpriced movement handler '{debug_name}'")
    return price["extraTicks"]



@dataclass
class LocConfig:
    loc_id: int
    debug_name: str
    display_name: str | None = None
    options: list[str | None] = field(default_factory=lambda: [None] * 5)


@dataclass(frozen=True)
class Placement:
    loc_id: int
    x: int
    z: int
    level: int
    shape: int
    angle: int


SECTION_RE = re.compile(r"^\[([^\]]+)]\s*$")
MAP_FILE_RE = re.compile(r"^m(\d+)_(\d+)\.jm2$")
LOC_LINE_RE = re.compile(
    r"^(\d+)\s+(\d+)\s+(\d+):\s+(\d+)\s+(\d+)(?:\s+(\d+))?\s*$"
)

# scripts/general_use/scripts/manholes.rs2:1-10 opens 881 as 882 before descent.
OPEN_LOC_DEBUGS = {"manholeclosed": "manholeopen", "plaguemanholeclosed": "plaguemanholeopen"}


def clean_value(value: str) -> str:
    return value.split("//", 1)[0].strip()


def load_loc_configs(content: Path) -> dict[int, LocConfig]:
    id_to_debug: dict[int, str] = {}
    for raw in (content / "pack" / "loc.pack").read_text(encoding="utf-8").splitlines():
        if "=" not in raw:
            continue
        raw_id, debug_name = raw.split("=", 1)
        id_to_debug[int(raw_id)] = debug_name.strip()

    configs = {
        loc_id: LocConfig(loc_id=loc_id, debug_name=debug_name)
        for loc_id, debug_name in id_to_debug.items()
    }
    debug_to_id = {debug_name: loc_id for loc_id, debug_name in id_to_debug.items()}

    # Historical unpacked definitions are cumulative. Apply them by revision,
    # then authored definitions as the final overrides.
    unpacked = sorted(
        (content / "scripts" / "_unpack").glob("*/all.loc"),
        key=lambda path: int(path.parent.name),
    )
    authored = sorted(
        path
        for path in (content / "scripts").rglob("*.loc")
        if "_unpack" not in path.parts
    )

    for path in unpacked + authored:
        current: LocConfig | None = None
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            section = SECTION_RE.match(line)
            if section:
                current = configs.get(debug_to_id.get(section.group(1), -1))
                continue
            if current is None or "=" not in line or line.startswith("//"):
                continue
            key, value = line.split("=", 1)
            key = key.strip().lower()
            value = clean_value(value)
            if key == "name":
                current.display_name = value
            elif len(key) == 3 and key.startswith("op") and key[2].isdigit():
                index = int(key[2]) - 1
                if 0 <= index < 5:
                    current.options[index] = value

    return configs


def load_placements(content: Path) -> tuple[list[Placement], dict[tuple[int, int, int], list[Placement]]]:
    placements: list[Placement] = []
    spatial: dict[tuple[int, int, int], list[Placement]] = defaultdict(list)
    for path in sorted((content / "maps").glob("m*_*.jm2")):
        match = MAP_FILE_RE.match(path.name)
        if not match:
            continue
        mx, mz = map(int, match.groups())
        in_locs = False
        for raw in path.read_text(encoding="utf-8").splitlines():
            if raw == "==== LOC ====":
                in_locs = True
                continue
            if in_locs and raw.startswith("==== "):
                break
            if not in_locs:
                continue
            loc = LOC_LINE_RE.match(raw)
            if not loc:
                continue
            level, local_x, local_z, loc_id, shape, angle = loc.groups()
            placement = Placement(
                loc_id=int(loc_id),
                x=mx * 64 + int(local_x),
                z=mz * 64 + int(local_z),
                level=int(level),
                shape=int(shape),
                angle=int(angle or 0),
            )
            placements.append(placement)
            spatial[(placement.x, placement.z, placement.level)].append(placement)
    return placements, spatial


def normalized(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def option_values(config: LocConfig) -> list[str]:
    return [option for option in config.options if option]


def candidates_near(
    spatial: dict[tuple[int, int, int], list[Placement]],
    point: dict[str, int],
    radius: int = 4,
) -> Iterable[tuple[int, Placement]]:
    # Map bridge flags can move a location down more than one effective level
    # in stacked/instanced map areas, so inspect every raw map level.
    levels = range(4)
    for level in levels:
        for dx in range(-radius, radius + 1):
            for dz in range(-radius, radius + 1):
                distance = max(abs(dx), abs(dz))
                for placement in spatial.get((point["x"] + dx, point["z"] + dz, level), []):
                    yield distance, placement


def resolve_source_loc(
    edge: dict,
    configs: dict[int, LocConfig],
    spatial: dict[tuple[int, int, int], list[Placement]],
    allowed_stair_debugs: set[str],
    revision: int,
) -> tuple[LocConfig, Placement] | None:
    wanted_name = normalized(edge.get("locName"))
    wanted_action = normalized(edge.get("action"))
    kind = normalized(edge.get("kind"))
    ranked: list[tuple[float, float, float, int, int, LocConfig, Placement]] = []

    source = edge["from"]
    destination = edge["to"]
    span = max(abs(destination["x"] - source["x"]), abs(destination["z"] - source["z"]))
    # Why: local crossings use the midpoint, but long transports need a loc near the source.
    use_midpoint = kind in {"door", "gate", "stair"} and span <= 8
    midpoint_x = (source["x"] + destination["x"]) / 2
    midpoint_z = (source["z"] + destination["z"]) / 2

    for distance, placement in candidates_near(spatial, edge["from"]):
        placed_config = configs.get(placement.loc_id)
        if not placed_config:
            continue
        variants = [placed_config]
        # Why: the map places the closed trapdoor; resolve its open config for the climb action.
        if wanted_action not in {normalized(option) for option in option_values(placed_config)}:
            open_debug = OPEN_LOC_DEBUGS.get(placed_config.debug_name, placed_config.debug_name + "_open")
            variants.extend(config for config in configs.values() if config.debug_name == open_debug)

        for config in variants:
            if kind == "stair" and config.debug_name not in allowed_stair_debugs:
                continue
            display = normalized(config.display_name)
            debug = normalized(config.debug_name)
            options = option_values(config)
            normalized_options = {normalized(option) for option in options}

            name_match = bool(wanted_name and display == wanted_name)
            action_match = bool(wanted_action and wanted_action in normalized_options)
            fuzzy_action = bool(
                wanted_action
                and any(
                    wanted_action in option or option in wanted_action
                    for option in normalized_options
                    if option
                )
            )
            kind_hint = (
                (kind == "stair" and any(token in debug for token in ("stair", "ladder")))
                or (kind in {"door", "gate"} and any(token in display for token in ("door", "gate")))
                or (kind == "gangplank" and "gangplank" in debug)
                or (kind in {"dungeon", "shortcut"} and action_match)
            )

            # Stairs always require the exact action; revision 377 applies that rule to dungeons too.
            if kind == "stair" or (revision == 377 and kind == "dungeon"):
                if not action_match:
                    continue
            elif not (name_match or action_match):
                continue
            score = 0
            if name_match:
                score += 100
            if action_match:
                score += 120
            elif fuzzy_action:
                score += 25
            if kind_hint:
                score += 20
            if placement.level == edge["from"]["level"]:
                score += 8
            corridor_distance = max(abs(placement.x - midpoint_x), abs(placement.z - midpoint_z))
            proximity = corridor_distance if use_midpoint else distance
            score -= proximity * 6
            # Why: Chebyshev distance ties two placements that sit one tile orthogonally and one tile diagonally from the stand (the Gu'Tanoth battlements at 2507,3011 and 2507,3012); the straight-line distance picks the one the stand is beside instead of the first one scanned.
            reference_x, reference_z = (midpoint_x, midpoint_z) if use_midpoint else (source["x"], source["z"])
            straight_line = (placement.x - reference_x) ** 2 + (placement.z - reference_z) ** 2
            ranked.append((score, -proximity, -straight_line, -distance, -placement.loc_id, config, placement))

    if not ranked:
        return None
    ranked.sort(key=lambda item: item[:5], reverse=True)
    best = ranked[0]
    # Name-only matches far from the source are too ambiguous for common names
    # such as Door, Gate, Ladder, and Staircase.
    if best[0] < 70:
        return None
    return best[5], best[6]


def edge_key(edge: dict) -> tuple[int, int, int, int, int, int, str, str]:
    source, destination = edge["from"], edge["to"]
    return (
        source["x"],
        source["z"],
        source["level"],
        destination["x"],
        destination["z"],
        destination["level"],
        edge.get("action", ""),
        edge.get("kind", ""),
    )


def closed_open_loc_ids(
    configs: dict[int, LocConfig],
    placement_loc_id: int,
    action_config: LocConfig,
) -> tuple:
    """Find the closed placement ID and open interaction ID for trapdoors.

    Use the closed variant as locId, even when the map places the open variant.
    openLocId identifies the variant with the climb or use action."""
    placed = configs.get(placement_loc_id)
    open_id: int | None = None
    closed_id = placement_loc_id

    if action_config.loc_id != placement_loc_id:
        # Ranked open config against closed placement.
        open_id = action_config.loc_id
        closed_id = placement_loc_id
        return closed_id, open_id

    # Placement and action config share an id; it may already be the open form.
    debug = (placed.debug_name if placed else action_config.debug_name) or ""
    base = next((closed for closed, opened in OPEN_LOC_DEBUGS.items() if opened == debug), None)
    if base is None and debug.endswith("_open"):
        base = debug[: -len("_open")]
    if base is not None:
        open_id = placement_loc_id
        for cfg in configs.values():
            if cfg.debug_name == base:
                closed_id = cfg.loc_id
                break
        return closed_id, open_id

    # Closed placement; look for conventional open partner.
    open_debug = OPEN_LOC_DEBUGS.get(debug, debug + "_open")
    for cfg in configs.values():
        if cfg.debug_name == open_debug:
            open_id = cfg.loc_id
            break
    return closed_id, open_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--content", type=Path, required=True)
    parser.add_argument("--rs2b0t", type=Path, default=Path("."))
    parser.add_argument("--transports-output", type=Path, default=Path("src/bot/event/webwalk/data/transports.json"))
    parser.add_argument("--stairs-output", type=Path, default=Path("src/bot/event/webwalk/data/stairEdges.json"))
    parser.add_argument("--check", action="store_true", help="fail unless rerunning this stage on the committed files reproduces them; sh tools/nav/derive-transports.sh --check checks the whole pipeline")
    args = parser.parse_args()

    revision = selected_revision()
    prices = load_stair_prices() if revision == 377 else None

    configs = load_loc_configs(args.content)
    _, spatial = load_placements(args.content)
    # Include quest ladders with oploc handlers, but exclude decorative ladders.
    allowed_stair_debugs: set[str] = set()
    movement_handler_ops: set[tuple[str, int]] = set()
    oploc_re = re.compile(r"^\[oploc([1-5]),([a-z0-9_]+)]", re.MULTILINE)
    oplocu_re = re.compile(r"^\[oplocu,([a-z0-9_]+)]", re.MULTILINE)
    use_handlers: set[str] = set()
    for script in (args.content / "scripts").rglob("*.rs2"):
        text = script.read_text(encoding="utf-8")
        handlers = {(name, int(option)) for option, name in oploc_re.findall(text)}
        movement_handler_ops.update(handlers)
        allowed_stair_debugs.update(name for name, _ in handlers)
        use_handlers.update(oplocu_re.findall(text))
    allowed_stair_debugs.update({"laddertop", "ladder", "laddermiddle", "laddertop_directional", "ladder_directional"})
    data_dir = args.rs2b0t / "src" / "bot" / "event" / "webwalk" / "data"
    curated = json.loads((data_dir / "transports.json").read_text(encoding="utf-8"))
    stairs = json.loads((data_dir / "stairEdges.json").read_text(encoding="utf-8"))

    def matching_options(config: LocConfig | None, action: str | None) -> list[int]:
        wanted = normalized(action)
        if not wanted:
            return []
        return [
            index + 1
            for index, option in enumerate(config.options if config else [])
            if normalized(option) == wanted
        ]

    def disable_unhandled_movement(edge: dict, config: LocConfig | None) -> bool:
        if revision != 377 or edge.get("kind") not in {"stair", "dungeon"} or edge.get("disabledReason"):
            return False
        handler = config.debug_name if config is not None else None
        if handler and any((handler, op) in movement_handler_ops for op in matching_options(config, edge.get("action"))):
            return False
        # Why: a crossing opened by using an item (Dig with a spade on the Plague City mud patch) is an oplocu handler, and its action is not one of the loc's own options.
        placed = configs.get(edge.get("locId", -1))
        if (
            placed is not None
            and placed.debug_name in use_handlers
            and edge.get("requires", {}).get("items")
            and normalized(edge.get("action")) not in {normalized(option) for option in option_values(placed)}
        ):
            return False
        edge["disabledReason"] = "No matching revision 377 OPLOC handler for this location action."
        edge.pop("extraTicks", None)
        return True

    def apply_price(edge: dict) -> None:
        debug_name = edge.get("debugName")
        if not debug_name:
            return
        if edge.get("extraTicks") is not None:
            return
        # Disabled rows cannot be traversed, so a missing script body has no movement price.
        if edge.get("disabledReason"):
            return

        price = prices.get(debug_name) if prices is not None else None
        if price is not None:
            op = None
            if price.get("opPrices") is not None:
                config = configs.get(edge.get("openLocId") or edge.get("locId", -1))
                matches = matching_options(config, edge.get("action"))
                if len(matches) != 1:
                    raise RuntimeError(f"Cannot resolve priced option for movement handler '{debug_name}'")
                op = matches[0]
            edge["extraTicks"] = extra_ticks(prices, debug_name, op)
        elif revision == 377 and edge.get("kind") in {"stair", "dungeon"}:
            raise RuntimeError(f"Unpriced movement handler '{debug_name}'")

    def enrich(edges: list[dict]) -> list[dict]:
        enriched: list[dict] = []
        for raw in edges:
            edge = dict(raw)
            existing = configs.get(edge.get("locId", -1))
            source_backed_ladder = existing is not None and (
                normalized(existing.display_name) == "ladder"
                or "ladder" in existing.debug_name.lower()
            )
            # Keep ladder placements derived from handlers; refresh metadata for all other edges.
            if source_backed_ladder and all(field in edge for field in ("locId", "locX", "locZ", "debugName", "options")):
                if disable_unhandled_movement(edge, existing):
                    enriched.append(edge)
                    continue
                apply_price(edge)
                enriched.append(edge)
                continue
            action_config = None
            resolved = resolve_source_loc(edge, configs, spatial, allowed_stair_debugs, revision)
            if resolved:
                config, placement = resolved
                action_config = config
                edge["locX"] = placement.x
                edge["locZ"] = placement.z
                edge["debugName"] = config.debug_name
                edge["options"] = option_values(config) or [edge["action"]]
                closed_id, open_id = closed_open_loc_ids(configs, placement.loc_id, config)
                edge["locId"] = closed_id
                if open_id is not None and open_id != closed_id:
                    edge["openLocId"] = open_id
                else:
                    edge.pop("openLocId", None)
            else:
                edge["options"] = [edge["action"]]
            if disable_unhandled_movement(edge, action_config):
                enriched.append(edge)
                continue
            apply_price(edge)
            enriched.append(edge)
        return enriched

    enriched_curated = enrich(curated)
    enriched_stairs = enrich(stairs)

    def write_json(path: Path, edges: list[dict]) -> None:
        text = "[\n" + ",\n".join("    " + json.dumps(edge, separators=(",", ":")) for edge in edges) + "\n]\n"
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                raise SystemExit(f"STALE: {path} — run {Path(__file__).name} --content <LostCity Content checkout>")
            print(f"ok: {path} is up to date")
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")

    write_json(args.transports_output, enriched_curated)
    write_json(args.stairs_output, enriched_stairs)

    combined = [*enriched_curated, *enriched_stairs]
    resolved_count = sum("locId" in edge for edge in combined)
    cross_file_keys = {edge_key(edge) for edge in curated} & {edge_key(edge) for edge in stairs}
    kinds: dict[str, int] = defaultdict(int)
    for edge in combined:
        kinds[edge.get("kind", "unknown")] += 1
    print(
        json.dumps(
            {
                "outputs": [str(args.transports_output), str(args.stairs_output)],
                "edges": len(combined),
                "curatedEdges": len(enriched_curated),
                "stairEdges": len(enriched_stairs),
                "locMetadataResolved": resolved_count,
                "unresolved": len(combined) - resolved_count,
                "disabled": sum(bool(edge.get("disabledReason")) for edge in combined),
                "crossFileDuplicateEdges": len(cross_file_keys),
                "kinds": dict(sorted(kinds.items())),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
