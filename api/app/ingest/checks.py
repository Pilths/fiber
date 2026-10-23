"""Pure row checks shared by the checker command, the seed and the upload preview. A check returns a reason or None."""
import re
from collections.abc import Iterable

LAT_RANGE = (-11.0, 21.0)
LON_RANGE = (92.0, 141.0)
MAX_PORT_SPAN = 288

REGIONS = {
    "north": "North", "nothern": "North", "northern": "North", "nothern region": "North",
    "central": "Central",
    "south": "South", "southern": "South", "souther": "South",
    "east coast": "East Coast", "east": "East Coast", "eastcoast": "East Coast",
}


def norm(v: object) -> str:
    return " ".join(str(v).split()).casefold()


def blank(v: object) -> bool:
    return v is None or not str(v).strip()


def _in_box(lat: float, lon: float) -> bool:
    return LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LON_RANGE[0] <= lon <= LON_RANGE[1]


def check_coords(lat: float | None, lon: float | None) -> str | None:
    if lat is None or lon is None:
        return "missing coordinates"
    if lat == 0 and lon == 0:
        return "coordinates are 0,0"
    if _in_box(lat, lon):
        return None
    if _in_box(lon, lat):
        return f"latitude and longitude look swapped ({lat}, {lon})"
    return f"coordinates outside the Southeast Asia box ({lat}, {lon})"


def map_region(v: object) -> tuple[str | None, str | None]:
    if blank(v):
        return None, "region is blank"
    region = REGIONS.get(norm(v))
    return region, None if region else f"unknown region '{str(v).strip()}'"


def split_nodes(v: object) -> tuple[str, str, bool] | None:
    """'AABB-BBCC' or 'AABB-BBCC (additional core)' -> (site, site, additional)."""
    if blank(v):
        return None
    s, additional = re.subn(r"\(\s*additional\s+core\s*\)", "", str(v), flags=re.I)
    parts = [p.strip() for p in s.split("-")]
    if len(parts) != 2 or not all(parts) or parts[0] == parts[1]:
        return None
    return parts[0], parts[1], bool(additional)


def check_known_sites(codes: Iterable[str], known: set[str] | None) -> str | None:
    if not known:
        return None
    unknown = [c for c in codes if c not in known]
    return f"unknown site code {', '.join(unknown)}" if unknown else None


def check_requestor(v: object) -> str | None:
    return "blank requestor" if blank(v) else None


def duplicate_names(names: Iterable[str]) -> set[str]:
    seen: set[str] = set()
    dup: set[str] = set()
    for n in names:
        (dup if n in seen else seen).add(n)
    return dup


Blocks = list[tuple[str, list[str]]]  # (site code, port labels in order)


def pair_ports(cell: object) -> tuple[Blocks | None, str | None]:
    """Core assignment cell -> two (site code, port labels) blocks of equal length, or a reason.

    A block is the lines before its last range, e.g. 'AABB / Tray 1 / P1-P2' gives AABB and 'AABB Tray 1 P1', 'AABB Tray 1 P2'.
    """
    if blank(cell):
        return None, "core assignment is blank"
    chunks = [c for c in re.split(r"\n\s*\n", str(cell).strip()) if c.strip()]
    if len(chunks) != 2:
        return None, f"core assignment has {len(chunks)} site blocks, expected 2"
    blocks: Blocks = []
    for chunk in chunks:
        lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
        ranges = list(re.finditer(r"P(\d+)\s*-\s*P?(\d+)\s*$", lines[-1], flags=re.I))
        if not ranges:
            return None, f"no port range (P<n>-P<m>) for '{lines[0]}'"
        start, end = int(ranges[-1].group(1)), int(ranges[-1].group(2))
        if end < start or end - start > MAX_PORT_SPAN:
            return None, f"malformed port range {ranges[-1].group(0)} for '{lines[0]}'"
        prefix = " ".join(lines[:-1] + [lines[-1][:ranges[-1].start()].strip()]).strip()
        blocks.append((lines[0].split()[0], [f"{prefix} P{n}" for n in range(start, end + 1)]))
    if len(blocks[0][1]) != len(blocks[1][1]):
        return None, f"port ranges differ in length ({len(blocks[0][1])} vs {len(blocks[1][1])})"
    return blocks, None
