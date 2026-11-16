"""Constants, row and sheet types and cell helpers shared by the site master modules."""
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from app.ingest.checks import clean

BLANKS = {"", "tba", "n/a", "na", "-", "tbc"}
DROP_LIMIT = (9, 10)  # a sheet with file rows * 10 <= database rows * 9 (10% or more fewer) is blocked
UPLOAD_REASON = "site master upload"
LOCATION_FIELDS = {"location", "geom", "lat", "lon", "latitude", "longitude"}
SHEETS = {  # kind: (required header keys, expected-headers text, entity, own header keys)
    "sites": (
        ("sitename", "latitudeindecimal", "longitudeindecimal"),
        "site_name, latitude_in_decimal, longitude_in_decimal",
        "site",
        {"sitename", "latitudeindecimal", "longitudeindecimal", "region", "type"},
    ),
}
# Type column of the Sites sheet; blank or Trunk means a trunk site ('site')
SITE_KINDS = {"trunk": "site", "dc": "data_center", "toc": "toc"}
GROUP_COL = {
    "added": "new",
    "changed": "changed",
    "missing": "missing",
    "problem": "needs_review",
    "unchanged": "unchanged",
}
APPLY_COUNTERS = ["added", "changed", "protected_kept", "deactivated", "kept_active", "skipped"]


def isblank(value: Any) -> bool:
    """Empty, TBA, N/A, NA, -, TBC (any case) are blank, never invalid text."""
    if value is None:
        return True
    return str(clean(value)).strip().casefold() in BLANKS


def hkey(header: Any) -> str:
    return re.sub(r"[^0-9a-z]", "", str(header).casefold())


def _fmt(lat: float | None, lon: float | None) -> str | None:
    if lat is None or lon is None:
        return None
    return f"{lat:.6f},{lon:.6f}"


def _num(value: Any) -> tuple[float | None, str | None]:
    if isblank(value):
        return None, None
    try:
        return float(str(value).strip()), None
    except ValueError:
        return None, f"cannot read '{str(value).strip()}'"


def _cell_text(value: Any) -> str | None:
    if isblank(value):
        return None
    return str(value).strip()


@dataclass
class Item:
    row_number: int
    raw: dict[str, Any]
    parsed: dict[str, Any]  # parsed fields; parsed["reasons"] are the parse-stage reasons
    id: int | None = None
    status: str = "ready"
    reason: str | None = None
    group: str = "unchanged"
    changes: list[dict[str, Any]] = field(default_factory=list)
    db_id: int | None = None


@dataclass
class DbSite:
    id: int
    name: str
    kind: str
    active: bool
    lat: float | None
    lon: float | None
    details: dict[str, Any]
    lrd_id: int | None  # old DC List rows have one; kept as stored, never written by an upload

    @property
    def cls(self) -> str:
        # old DC List rows (a DC with an LRD site) are not part of the Sites sheet and are left alone
        if self.kind == "data_center" and self.lrd_id is not None:
            return "dc_list"
        return "sites"


@dataclass
class ParsedSheet:
    kind: str
    sheet_name: str | None
    items: list[Item]
    found: bool = True


@dataclass
class SheetResult:
    kind: str
    sheet_name: str | None
    found: bool
    items: list[Item] = field(default_factory=list)
    missing: list[DbSite] = field(default_factory=list)
    in_use: set[int] = field(default_factory=set)
    block_reasons: list[str] = field(default_factory=list)
    hard: bool = False  # a block the admin cannot override

    @property
    def blocked(self) -> bool:
        return bool(self.block_reasons)

    @property
    def counts(self) -> dict[str, int]:
        groups = Counter(item.group for item in self.items)
        return {
            "rows": len(self.items),
            "added": groups["added"],
            "changed": groups["changed"],
            "missing": len(self.missing),
            "problem": groups["problem"],
            "unchanged": groups["unchanged"],
        }

    def summary(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "sheet_name": self.sheet_name,
            "found": self.found,
            "blocked": self.blocked,
            "block_reasons": self.block_reasons,
            "counts": self.counts,
            "needs_override": self.blocked and not self.hard,
        }


def _can_apply(result: SheetResult, override_on: bool) -> bool:
    """A found sheet can be applied unless it is blocked; a soft block yields to an override."""
    if not result.found:
        return False
    if not result.blocked:
        return True
    return not result.hard and override_on
