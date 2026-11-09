#!/usr/bin/env python3
"""Derive ladder edges from map placements and RuneScript destinations.

Keep broken, dialogue, choice and state-dependent handlers as disabled rows.
Access requirements are not fully modelled, so active edges can still fail at runtime."""

from __future__ import annotations

import argparse
import gzip
import importlib.util
import json
import re
import struct
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable



def load_enrichment_module():
    path = Path(__file__).with_name("enrich-transports.py")
    spec = importlib.util.spec_from_file_location("transport_enrichment", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


enrichment = load_enrichment_module()


@dataclass(frozen=True)
class EffectivePlacement:
    loc_id: int
    x: int
    z: int
    level: int
    shape: int
    angle: int


@dataclass(frozen=True)
class Target:
    x: int
    z: int
    level: int


class Reader:
    def __init__(self, data: bytes):
        self.data = data
        self.pos = 0

    def g1(self) -> int:
        value = self.data[self.pos]
        self.pos += 1
        return value

    def gsmart(self) -> int:
        return self.g1() if self.data[self.pos] < 0x80 else (self.g1() << 8 | self.g1()) - 0x8000


def packed_index(x: int, z: int, level: int) -> int:
    return (z & 0x3F) | ((x & 0x3F) << 6) | ((level & 3) << 12)


def parse_land(data: bytes) -> bytearray:
    reader = Reader(data)
    flags = bytearray(64 * 64 * 4)
    for level in range(4):
        for x in range(64):
            for z in range(64):
                while True:
                    opcode = reader.g1()
                    if opcode == 0:
                        break
                    if opcode == 1:
                        reader.g1()
                        break
                    if opcode <= 49:
                        reader.g1()
                    elif opcode <= 81:
                        flags[packed_index(x, z, level)] = opcode - 49
    return flags


def parse_locs(data: bytes) -> Iterable[tuple[int, int, int, int, int, int]]:
    reader = Reader(data)
    loc_id = -1
    loc_delta = reader.gsmart()
    while loc_delta:
        loc_id += loc_delta
        coord = 0
        coord_delta = reader.gsmart()
        while coord_delta:
            coord += coord_delta - 1
            z = coord & 0x3F
            x = (coord >> 6) & 0x3F
            level = (coord >> 12) & 3
            info = reader.g1()
            yield loc_id, x, z, level, info >> 2, info & 3
            coord_delta = reader.gsmart()
        loc_delta = reader.gsmart()


def load_effective_placements(engine: Path) -> list[EffectivePlacement]:
    archive_path = engine / "data" / "pack" / ".cache" / "maps-server.zip"
    if not archive_path.exists():
        raise SystemExit(f"Missing {archive_path}; build the LostCity engine maps first")
    placements: list[EffectivePlacement] = []
    with zipfile.ZipFile(archive_path) as archive:
        map_names = sorted(name for name in archive.namelist() if re.fullmatch(r"m\d+_\d+", name))
        for map_name in map_names:
            mx, mz = map(int, map_name[1:].split("_"))
            land = parse_land(archive.read(map_name))
            for loc_id, local_x, local_z, raw_level, shape, angle in parse_locs(archive.read(f"l{mx}_{mz}")):
                linked_below = land[packed_index(local_x, local_z, 1)] & 2
                level = raw_level - 1 if linked_below else raw_level
                if level < 0:
                    continue
                placements.append(EffectivePlacement(loc_id, mx * 64 + local_x, mz * 64 + local_z, level, shape, angle))
    return placements


class CollisionPack:
    def __init__(self, path: Path):
        raw = path.read_bytes()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        if raw[:4] != b"LCNV" or raw[4] not in (1, 2):
            raise SystemExit(f"Unsupported collision pack: {path}")
        version = raw[4]
        count = struct.unpack_from("<H", raw, 8)[0]
        self.walk: dict[tuple[int, int, int], bytes] = {}
        self.exit: dict[tuple[int, int, int], bytes] = {}
        self.wall: dict[tuple[int, int, int], bytes] = {}
        pos = 10
        for _ in range(count):
            mx, mz, mask = raw[pos : pos + 3]
            pos += 3
            for level in range(4):
                if not mask & (1 << level):
                    continue
                self.exit[(mx, mz, level)] = raw[pos : pos + 4096]
                pos += 4096
                self.walk[(mx, mz, level)] = raw[pos : pos + 512]
                pos += 512
                if version >= 2:
                    self.wall[(mx, mz, level)] = raw[pos : pos + 2048]
                    pos += 2048
        if pos != len(raw):
            raise SystemExit(f"Collision pack is truncated or has trailing bytes: read {pos} of {len(raw)}")

    def walkable(self, x: int, z: int, level: int) -> bool:
        walk = self.walk.get((x >> 6, z >> 6, level))
        if walk is None:
            return False
        index = (x & 0x3F) * 64 + (z & 0x3F)
        return bool(walk[index >> 3] & (1 << (index & 7)))

    def exit_mask(self, x: int, z: int, level: int) -> int:
        exit_bytes = self.exit.get((x >> 6, z >> 6, level))
        if exit_bytes is None:
            return 0
        return exit_bytes[(x & 0x3F) * 64 + (z & 0x3F)]

    def sealed(self, x: int, z: int, level: int) -> bool:
        """Walkable tile with no exit."""
        return self.exit_mask(x, z, level) == 0

    def wall_mask(self, x: int, z: int, level: int) -> int:
        """Per-tile wall faces, the same nibble the walker's PathFinder.wallMask reads; zero in a version 1 pack."""
        wall = self.wall.get((x >> 6, z >> 6, level))
        if wall is None:
            return 0
        index = (x & 0x3F) * 64 + (z & 0x3F)
        return (wall[index >> 1] >> 4 if index & 1 else wall[index >> 1]) & 0xF


def offsets(radius: int) -> list[tuple[int, int]]:
    values = [(dx, dz) for dx in range(-radius, radius + 1) for dz in range(-radius, radius + 1)]
    return sorted(values, key=lambda p: (max(abs(p[0]), abs(p[1])), abs(p[0]) + abs(p[1]), -p[1], p[0]))


SNAP_OFFSETS = offsets(2)


def snap(pack: CollisionPack, target: Target) -> Target | None:
    # Why: a landing with no exit strands the walker; otherwise keep the existing order.
    fallback: Target | None = None
    for dx, dz in SNAP_OFFSETS:
        x, z = target.x + dx, target.z + dz
        if not pack.walkable(x, z, target.level):
            continue
        if fallback is None:
            fallback = Target(x, z, target.level)
        if not pack.sealed(x, z, target.level):
            return Target(x, z, target.level)
    return fallback


# A Climb is accepted from a cardinal neighbour of the loc's footprint with no wall between the two (the walker's PathFinder.cardinalGoals rule).
STAND_SIDES = ((0, 1, 1 << 2), (1, 0, 1 << 3), (0, -1, 1 << 0), (-1, 0, 1 << 1))
FOOTPRINT_RADIUS = 2


def operable_stands(pack: CollisionPack, target: Target) -> set[tuple[int, int]]:
    """Walkable tiles beside a blocking placement's footprint with no wall facing it; empty when the placement is walkable."""
    if pack.walkable(target.x, target.z, target.level):
        return set()
    solid = {(target.x, target.z)}
    stack = [(target.x, target.z)]
    while stack:
        cx, cz = stack.pop()
        for dx, dz, _ in STAND_SIDES:
            nx, nz = cx + dx, cz + dz
            if max(abs(nx - target.x), abs(nz - target.z)) > FOOTPRINT_RADIUS or (nx, nz) in solid or pack.walkable(nx, nz, target.level):
                continue
            solid.add((nx, nz))
            stack.append((nx, nz))
    stands: set[tuple[int, int]] = set()
    for sx, sz in solid:
        for dx, dz, facing in STAND_SIDES:
            cx, cz = sx + dx, sz + dz
            if pack.walkable(cx, cz, target.level) and not pack.wall_mask(cx, cz, target.level) & facing:
                stands.add((cx, cz))
    return stands


def stand_candidates(pack: CollisionPack, target: Target) -> list[Target]:
    """Tiles to climb from, best first: for a blocking placement only tiles the server accepts (never across its own wall or from a diagonal), otherwise snap()'s tile."""
    stands = operable_stands(pack, target)
    if not stands:
        fallback = snap(pack, target)
        return [fallback] if fallback else []
    ordered: list[tuple[int, int]] = []
    for dx, dz in SNAP_OFFSETS:
        tile = (target.x + dx, target.z + dz)
        if tile in stands and tile not in ordered:
            ordered.append(tile)
    ordered.extend(sorted(stands - set(ordered)))
    ordered.sort(key=lambda tile: pack.sealed(tile[0], tile[1], target.level))
    return [Target(x, z, target.level) for x, z in ordered]


COORD_RE = re.compile(r"^(\d+)_(\d+)_(\d+)_(\d+)_(\d+)$")


def parse_coord(value: str) -> Target | None:
    match = COORD_RE.fullmatch(value.strip())
    if not match:
        return None
    level, mx, mz, lx, lz = map(int, match.groups())
    return Target(mx * 64 + lx, mz * 64 + lz, level)


def coord_text(target: EffectivePlacement | Target) -> str:
    return f"{target.level}_{target.x >> 6}_{target.z >> 6}_{target.x & 63}_{target.z & 63}"


HEADER_RE = re.compile(r"^\[([^\]]+)][ \t]*(.*)$", re.MULTILINE)


def load_handlers(content: Path) -> tuple[dict[tuple[str, int], str], dict[str, str]]:
    handlers: dict[tuple[str, int], str] = {}
    aliases: dict[tuple[str, int], str] = {}
    labels: dict[str, str] = {}
    for path in (content / "scripts").rglob("*.rs2"):
        text = path.read_text(encoding="utf-8")
        matches = list(HEADER_RE.finditer(text))
        for index, match in enumerate(matches):
            header = match.group(1)
            trailer = (match.group(2) or "").strip()
            body = text[match.end() : matches[index + 1].start() if index + 1 < len(matches) else len(text)]
            oploc = re.fullmatch(r"oploc([1-5]),([^,]+)", header)
            label = re.fullmatch(r"label,([^,]+)", header)
            if oploc:
                key = (oploc.group(2), int(oploc.group(1)))
                handlers[key] = body
                alias = re.fullmatch(r"@([a-zA-Z0-9_]+);?", trailer)
                if alias:
                    aliases[key] = alias.group(1)
            elif label:
                labels[label.group(1)] = body
    for key, alias in aliases.items():
        if alias in labels:
            handlers[key] = labels[alias]
    return handlers, labels


def matching_brace(text: str, opening: int) -> int:
    depth = 0
    for index in range(opening, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return index
    return len(text) - 1


def select_switch(body: str, placement: EffectivePlacement, switch_type: str) -> str:
    expression = r"\s*loc_angle\s*" if switch_type == "int" else r"[^)]*"
    match = re.search(rf"switch_{switch_type}\s*\({expression}\)\s*{{", body)
    if not match:
        return body
    opening = body.find("{", match.start())
    closing = matching_brace(body, opening)
    switch_body = body[opening + 1 : closing]
    cases = list(re.finditer(r"\bcase\s+([^:]+)\s*:", switch_body))
    selected = ""
    fallback = ""
    for index, case in enumerate(cases):
        value = case.group(1).strip()
        segment = switch_body[case.end() : cases[index + 1].start() if index + 1 < len(cases) else len(switch_body)]
        if value == "default":
            fallback = segment
        elif switch_type == "int" and value.isdigit() and int(value) == placement.angle:
            selected = segment
        elif switch_type == "coord" and value == coord_text(placement):
            selected = segment
    return body[: match.start()] + (selected or fallback) + body[closing + 1 :]


LOC_COORD_IF_RE = re.compile(r"if\s*\(\s*loc_coord(?:\s*\(\s*\))?\s*=\s*(\d+_\d+_\d+_\d+_\d+)\s*\)\s*{")


def select_loc_coord_ifs(body: str, placement: EffectivePlacement) -> str:
    """Resolve `if(loc_coord = <coord>) { ... }` special cases for one placement.

    Why: 377 ladders.rs2 `ladder_1755` special-cases the Zanaris placement with an early `return` instead of a `switch_coord`, so without this every placement of that ladder looks like it has two destinations.
    """
    while True:
        match = LOC_COORD_IF_RE.search(body)
        if not match:
            return body
        opening = body.find("{", match.start())
        closing = matching_brace(body, opening)
        block = body[opening + 1 : closing]
        if match.group(1) != coord_text(placement):
            body = body[: match.start()] + body[closing + 1 :]
        elif re.search(r"\breturn\s*;", block):
            return body[: match.start()] + block
        else:
            body = body[: match.start()] + block + body[closing + 1 :]


def call_arguments(text: str, names: tuple[str, ...]) -> list[str]:
    calls: list[str] = []
    token = re.compile(r"(?<![a-zA-Z0-9_])(" + "|".join(re.escape(name) for name in names) + r")\s*\(")
    for match in token.finditer(text):
        opening = text.find("(", match.start())
        depth = 0
        quote = False
        argument_end = -1
        for index in range(opening + 1, len(text)):
            char = text[index]
            if char == '"' and (index == 0 or text[index - 1] != "\\"):
                quote = not quote
            if quote:
                continue
            if char == "(":
                depth += 1
            elif char == ")":
                if depth == 0:
                    argument_end = index
                    break
                depth -= 1
            elif char == "," and depth == 0:
                argument_end = index
                break
        if argument_end != -1:
            calls.append(text[opening + 1 : argument_end].strip())
    return calls


def split_args(value: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    for index, char in enumerate(value):
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(value[start:index].strip())
            start = index + 1
    parts.append(value[start:].strip())
    return parts


def resolve_expression(
    expression: str,
    placement: EffectivePlacement,
    stand: Target,
    body: str,
    player_relative: list[bool] | None = None,
    visiting: frozenset[str] = frozenset(),
) -> Target | None:
    expression = expression.strip()
    direct = parse_coord(expression)
    if direct:
        return direct
    if expression in {"coord", "coord()"}:
        if player_relative is not None:
            player_relative[0] = True
        return stand
    if expression in {"loc_coord", "loc_coord()"}:
        return Target(placement.x, placement.z, placement.level)
    map_square = re.fullmatch(r"map_findsquare\s*\((.+)\)", expression, re.DOTALL)
    if map_square:
        return resolve_expression(split_args(map_square.group(1))[0], placement, stand, body, player_relative, visiting)
    move = re.fullmatch(r"movecoord\s*\((.+)\)", expression, re.DOTALL)
    if move:
        args = split_args(move.group(1))
        if len(args) != 4 or not all(re.fullmatch(r"-?\d+", value) for value in args[1:]):
            return None
        base = resolve_expression(args[0], placement, stand, body, player_relative, visiting)
        if base is None:
            return None
        dx, dl, dz = map(int, args[1:])
        return Target(base.x + dx, base.z + dz, base.level + dl)
    if re.fullmatch(r"\$[a-zA-Z0-9_]+", expression) and expression not in visiting:
        variable = re.escape(expression)
        assignments = re.findall(rf"{variable}\s*=\s*([^;]+);", body)
        if len(assignments) == 1:
            return resolve_expression(assignments[0], placement, stand, body, player_relative, visiting | {expression})
    return None


def destinations(
    debug_name: str,
    body: str,
    placement: EffectivePlacement,
    stand: Target,
    player_targets: set[Target] | None = None,
) -> tuple[list[Target], str | None]:
    body = select_loc_coord_ifs(select_switch(select_switch(body, placement, "int"), placement, "coord"), placement)

    # Zanaris's ladder_from_cellar returns early with a special destination instead of z - 6400.
    if debug_name == "ladder_from_cellar":
        if coord_text(placement) == "0_50_149_22_52":
            return [Target(3201, 3169, 0)], None
        target = Target(stand.x, stand.z - 6400, stand.level)
        if player_targets is not None:
            player_targets.add(target)
        return [target], None

    expressions = call_arguments(body, ("~climb_ladder", "p_teleport", "p_telejump"))
    resolved = []
    for expression in expressions:
        player_relative = [False]
        target = resolve_expression(expression, placement, stand, body, player_relative)
        if target:
            resolved.append(target)
            if player_relative[0] and player_targets is not None:
                player_targets.add(target)
    # dragonshipladdertop2 uses a fixed fallback only when the usual landing is blocked.
    if not resolved and "$coord" in expressions:
        assignments = re.findall(r"\$coord\s*=\s*([^;]+);", body)
        normal_relative = [False]
        normal = resolve_expression(assignments[0], placement, stand, body, normal_relative) if assignments else None
        fallback_match = re.search(r"\$coord\s*=\s*(\d+_\d+_\d+_\d+_\d+)\s*;", body)
        fallback = parse_coord(fallback_match.group(1)) if fallback_match else None
        if normal:
            resolved.append(normal)
            if normal_relative[0] and player_targets is not None:
                player_targets.add(normal)
        if fallback:
            resolved.append(fallback)
    unique = list(dict.fromkeys(resolved))
    if len(unique) > 1:
        if "p_choice" in body:
            return unique, "This action opens an up/down choice; use a direct Climb-up or Climb-down option instead."
        return unique, "Destination depends on player or world state; state-aware transports are deferred."
    if unique:
        # Quest, skill or inventory checks still gate a single teleport; keep those edges disabled.
        if has_runtime_destination_guard(body) and debug_name not in ALWAYS_ACTIVE_LADDER_DEBUGS:
            return unique, (
                "Destination is behind a runtime quest/skill/inv guard; "
                "state-aware transports are deferred."
            )
        return unique, None
    if "@ladder_options" in body:
        return [], "This action opens an up/down choice; use a direct Climb-up or Climb-down option instead."
    if "broken" in body.lower() or "not going to climb" in body.lower() or "don't trust that ladder" in body.lower():
        return [], "LostCity implements this as a non-traversable ladder."
    if re.search(r"(?:chat|mes|npc_find)", body):
        return [], "This ladder starts dialogue but LostCity has no movement destination on the loc action."
    return [], "LostCity has no statically identifiable movement destination for this ladder action."


# Ladders with an unconditional teleport despite other checks in the script.
ALWAYS_ACTIVE_LADDER_DEBUGS = frozenset(
    {
        "ladder",
        # 377 names the Mining Guild ladder by id; its Mining 60 check (mining_guild.rs2:1-8) is plan-time state in specialRequires.TRANSPORT_SKILL_GATES, as miningguildladder was at 289.
        "ladder_2113",
        "laddertop",
        "laddermiddle",
        "ladder_directional",
        "laddertop_directional",
        "ladder_from_cellar",
        "ladder_cellar",
        "miningguildladder",
        "wizards_tower_ladder",
        "wizards_tower_laddertop",
    }
)


def has_runtime_destination_guard(body: str) -> bool:
    """Movement guarded by quest, skill, inventory or varp checks; collision-only fallbacks are allowed."""
    # Remove collision and occupancy checks; they do not depend on quest state.
    stripped = re.sub(r"if\s*\(\s*map_blocked\s*\([^)]*\)\s*\)\s*\{[^}]*\}", "", body, flags=re.I)
    stripped = re.sub(r"if\s*\(\s*~\w*blocked\w*\s*\([^)]*\)\s*\)\s*\{[^}]*\}", "", stripped, flags=re.I)
    return bool(
        re.search(r"if\s*\(\s*%[a-zA-Z0-9_]+", stripped)  # player varp
        or re.search(r"if\s*\(\s*stat\s*\(", stripped)  # skill gate
        or re.search(r"if\s*\(\s*inv_(?:total|count)\s*\(", stripped)
        or re.search(r"if\s*\(\s*testbit\s*\(\s*%", stripped)
        or re.search(r"if\s*\(\s*~\w*quest\w*\s*\(", stripped, re.I)
    )


# scripts/general_use/scripts/trapdoors.rs2:31-35 moves directly on Open in 377.
SCRIPTED_DUNGEON_OPS = {"trapdoor_14879": 1}


def is_ladder_config(config, revision: int = 289) -> bool:
    if revision == 377 and config.debug_name in SCRIPTED_DUNGEON_OPS:
        return True
    return bool(
        (enrichment.normalized(config.display_name) == "ladder" or "ladder" in config.debug_name.lower())
        and any(option and "climb" in option.lower() for option in config.options)
    )


def point(target: Target) -> dict[str, int]:
    return {"x": target.x, "z": target.z, "level": target.level}


# Why: snap() can pick an isolated multi-tile pocket, such as the strip outside Sinclair Mansion's north wall.
# Keyed by loc tile and approach level; both directions share the loc tile.
APPROACH_OVERRIDES: dict[tuple[int, int, int], tuple[int, int]] = {
    (2737, 3582, 0): (2736, 3582),
}


def make_edge(config, placement: EffectivePlacement, action: str, source: Target, target: Target, disabled_reason: str | None, extra_ticks: int | None = None) -> dict:
    override = APPROACH_OVERRIDES.get((placement.x, placement.z, source.level))
    if override is not None:
        source = Target(override[0], override[1], source.level)
    kind = "stair" if source.level != target.level else "dungeon"
    edge = {
        "from": point(source),
        "to": point(target),
        "locName": config.display_name or "Ladder",
        "action": action,
        "kind": kind,
        "locId": config.loc_id,
        "locX": placement.x,
        "locZ": placement.z,
        "debugName": config.debug_name,
        "options": enrichment.option_values(config) or [action],
    }
    if extra_ticks is not None:
        edge["extraTicks"] = extra_ticks
    if disabled_reason:
        edge["disabledReason"] = disabled_reason
    return edge


def pair_up_approaches(edges: list[dict], pack: CollisionPack) -> int:
    """Use the paired climb-down landing as the climb-up approach.

    snap() can pick an unreachable diagonal. The reverse landing is a usable
    approach when it is within two tiles of the ladder; distant teleport
    landings must keep their separately derived approach."""
    downs: dict[tuple[int, int], list[dict]] = {}
    for edge in edges:
        if "locX" not in edge or "locZ" not in edge:
            continue
        if edge["to"]["level"] < edge["from"]["level"]:
            downs.setdefault((edge["locX"], edge["locZ"]), []).append(edge)

    moved = 0
    for edge in edges:
        coord_offset = edge.pop("_coordOffset", None)
        if "locX" not in edge or "locZ" not in edge:
            continue
        if edge["to"]["level"] <= edge["from"]["level"]:
            continue
        paired = downs.get((edge["locX"], edge["locZ"]))
        if not paired:
            continue
        landings = {
            (d["to"]["x"], d["to"]["z"])
            for d in paired
            if d["to"]["level"] == edge["from"]["level"]
        }
        if len(landings) != 1:
            continue
        (lx, lz), = landings
        if (edge["from"]["x"], edge["from"]["z"]) == (lx, lz):
            continue
        if max(abs(lx - edge["locX"]), abs(lz - edge["locZ"])) > 2:
            continue
        # Why: the down edge's landing is the climber's own tile snapped to walkable, which can sit across a wall from the loc (the Black Knights' banquet ladder); never pair an approach the server would refuse.
        stands = operable_stands(pack, Target(edge["locX"], edge["locZ"], edge["from"]["level"]))
        if stands and (lx, lz) not in stands:
            continue
        edge["from"]["x"], edge["from"]["z"] = lx, lz
        if coord_offset is not None:
            edge["to"] = {
                "x": lx + coord_offset["x"],
                "z": lz + coord_offset["z"],
                "level": edge["from"]["level"] + coord_offset["level"],
            }
        moved += 1
    return moved


def edge_sort_key(edge: dict) -> tuple:
    source, target = edge["from"], edge["to"]
    return (
        source["level"], source["x"], source["z"], edge.get("locId", -1), edge.get("action", ""),
        target["level"], target["x"], target["z"], edge.get("disabledReason", ""),
    )


def legacy_ladder_edge(edge: dict, ladder_ids: set[int], ladder_debugs: set[str]) -> bool:
    # Why: curated routes may have no map placement and cannot be regenerated.
    if edge.get("curated"):
        return False
    if edge.get("locId") in ladder_ids or edge.get("debugName") in ladder_debugs:
        return True
    # Keep disabled non-ladder entries; rejected reverse edges can inherit ladder names from the forward edge.
    if edge.get("disabledReason"):
        return False
    name = enrichment.normalized(edge.get("locName"))
    action = enrichment.normalized(edge.get("action"))
    return "climb" in action and ("ladder" in name or name in {"rope", "escaperope"})


def write_json(path: Path, edges: list[dict], check: bool) -> None:
    text = "[\n" + ",\n".join("    " + json.dumps(edge, separators=(",", ":")) for edge in edges) + "\n]\n"
    if check:
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            raise SystemExit(f"STALE: {path} — run {Path(__file__).name}")
        print(f"ok: {path} is up to date")
    else:
        path.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--content", type=Path, required=True)
    parser.add_argument("--engine", type=Path, required=True)
    parser.add_argument("--pack", type=Path, default=Path("out/collision.lcnav.gz"))
    parser.add_argument("--rs2b0t", type=Path, default=Path("."))
    parser.add_argument("--check", action="store_true", help="fail unless rerunning this stage on the committed files reproduces them; sh tools/nav/derive-transports.sh --check checks the whole pipeline")
    args = parser.parse_args()

    revision = enrichment.selected_revision()
    prices = enrichment.load_stair_prices() if revision == 377 else None
    configs = enrichment.load_loc_configs(args.content)
    placements = load_effective_placements(args.engine)
    handlers, _ = load_handlers(args.content)
    collision = CollisionPack(args.pack)

    placed_by_id: dict[int, list[EffectivePlacement]] = {}
    for placement in placements:
        placed_by_id.setdefault(placement.loc_id, []).append(placement)
    ladder_configs = {loc_id: config for loc_id, config in configs.items() if loc_id in placed_by_id and is_ladder_config(config, revision)}
    ladder_ids = set(ladder_configs)
    ladder_debugs = {config.debug_name for config in ladder_configs.values()}

    generated: list[dict] = []
    interactions = 0
    unsnappable_sources = 0
    unsnappable = 0
    for loc_id, config in sorted(ladder_configs.items()):
        for placement in placed_by_id[loc_id]:
            source_raw = Target(placement.x, placement.z, placement.level)
            candidates = stand_candidates(collision, source_raw)
            snapped_source = candidates[0] if candidates else None
            source = snapped_source or source_raw
            source_reason = None
            if snapped_source is None:
                unsnappable_sources += 1
                source_reason = "The ladder has no walkable interaction tile within two squares in this collision pack."
            for op, action in enumerate(config.options, start=1):
                scripted_dungeon = revision == 377 and SCRIPTED_DUNGEON_OPS.get(config.debug_name) == op
                if not action or ("climb" not in action.lower() and not scripted_dungeon):
                    continue
                interactions += 1
                body = handlers.get((config.debug_name, op), "")
                # Why: a climb lands on the climber's own x,z one level away, so of the tiles the server accepts the stand is the one whose landing is walkable (the Black Knights' banquet ladder lands inside a wall from its east side).
                op_source = source
                player_targets: set[Target] = set()
                raw_targets, disabled_reason = destinations(config.debug_name, body, placement, source, player_targets)
                for candidate in candidates:
                    candidate_player_targets: set[Target] = set()
                    candidate_targets, candidate_reason = destinations(config.debug_name, body, placement, candidate, candidate_player_targets)
                    if candidate_targets and all(collision.walkable(t.x, t.z, t.level) for t in candidate_targets):
                        op_source, raw_targets, disabled_reason, player_targets = candidate, candidate_targets, candidate_reason, candidate_player_targets
                        break
                if config.debug_name == "dragonshipladdertop2" and len(raw_targets) == 2:
                    normal, fallback = raw_targets
                    raw_targets = [normal if collision.walkable(normal.x, normal.z, normal.level) else fallback]
                    disabled_reason = None
                disabled_reason = disabled_reason or source_reason
                price = enrichment.extra_ticks(prices, config.debug_name, op) if body else None
                if not raw_targets:
                    generated.append(make_edge(config, placement, action, op_source, op_source, disabled_reason, price))
                    continue
                for raw_target in raw_targets:
                    # Why: 377 content teleports to this exact tile; snapping it invents a landing not present in the handler.
                    target = raw_target if revision == 377 else snap(collision, raw_target)
                    reason = disabled_reason
                    if target is None:
                        unsnappable += 1
                        target = raw_target
                        reason = reason or "The scripted destination has no walkable tile within two squares in this collision pack."
                    edge = make_edge(config, placement, action, op_source, target, reason, price)
                    if revision == 377 and raw_target in player_targets:
                        edge["_coordOffset"] = {
                            "x": target.x - edge["from"]["x"],
                            "z": target.z - edge["from"]["z"],
                            "level": target.level - edge["from"]["level"],
                        }
                    generated.append(edge)
    data_dir = args.rs2b0t / "src" / "bot" / "event" / "webwalk" / "data"
    transport_path = data_dir / "transports.json"
    stair_path = data_dir / "stairEdges.json"
    transports = [edge for edge in json.loads(transport_path.read_text(encoding="utf-8")) if not legacy_ladder_edge(edge, ladder_ids, ladder_debugs)]
    stairs = [edge for edge in json.loads(stair_path.read_text(encoding="utf-8")) if not legacy_ladder_edge(edge, ladder_ids, ladder_debugs)]

    generated.sort(key=edge_sort_key)
    generated_transports = [edge for edge in generated if edge["kind"] == "dungeon"]
    generated_stairs = [edge for edge in generated if edge["kind"] == "stair"]
    output_transports = transports + generated_transports
    output_stairs = stairs + generated_stairs
    repaired = pair_up_approaches(output_stairs, collision) + pair_up_approaches(output_transports, collision)
    # Why: retain exact 377 script destinations but disable rows the pathfinder would silently drop.
    if revision == 377:
        for edge in generated:
            source, target = edge["from"], edge["to"]
            if not collision.walkable(source["x"], source["z"], source["level"]) or not collision.walkable(target["x"], target["z"], target["level"]):
                edge.setdefault("disabledReason", "The content-defined ladder approach or landing is not walkable in this collision pack.")
    write_json(transport_path, output_transports, args.check)
    write_json(stair_path, output_stairs, args.check)

    active = sum("disabledReason" not in edge for edge in generated)
    disabled = len(generated) - active
    print(json.dumps({
        "approachesPairedToDownLanding": repaired,
        "ladderLocTypes": len(ladder_configs),
        "placements": sum(len(placed_by_id[loc_id]) for loc_id in ladder_ids),
        "interactions": interactions,
        "generatedRows": len(generated),
        "active": active,
        "disabled": disabled,
        "sameLevelTransports": len(generated_transports),
        "levelChangeStairs": len(generated_stairs),
        "unsnappableSources": unsnappable_sources,
        "unsnappableDestinations": unsnappable,
        "requirementsModelled": False,
    }, indent=2))


if __name__ == "__main__":
    main()
