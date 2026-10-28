"""Pure row checks shared by the checker command, the seed and the upload preview. A check returns a reason or None."""
import re
from collections.abc import Iterable

LAT_RANGE = (-11.0, 21.0)
LON_RANGE = (92.0, 141.0)

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
    s, additional = re.subn(r"\(\s*additional\s+core\s*\)", "", str(v), flags=re.IGNORECASE)
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
