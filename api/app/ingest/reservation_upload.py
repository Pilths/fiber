"""Reservation workbook upload: stage every row raw, group it against the database, apply in one transaction.

Staging writes only `uploads` and `upload_rows`. Confirm re-runs `evaluate` on the staged rows against the current
database (switch, held cores, existing reservations), so a stale preview cannot import something that is no longer valid.
Reservations are insert-only: nothing here updates or deletes one.

Not built (parked or not in this workbook): reservation clash labels (New/Same/Differs/Clash), the "modify" proposal,
chained segments with more than one path (this workbook carries no segments), span route type (no column in it).
"""
import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ingest.excel import RowResult
from app.ingest.reservation_import import (
    Skip,
    add_cores,
    ensure_span,
    find_span,
    place_reservation,
)
from app.inventory import service as inventory
from app.routing.graph import invalidate as invalidate_routes

REASON = "reservation upload"
SPAN_FIELDS = ("region", "distance_km", "survey_cores")
GROUPS = ("new", "changed", "unchanged", "missing", "reservations", "conflicts", "already_imported", "ignored",
          "needs_review", "rejected")
ROW_GROUP = {"new": "new", "changed": "changed", "missing": "missing", "unchanged": "unchanged", "reservations": "new",
             "conflicts": "conflict", "already_imported": "unchanged", "ignored": "unchanged",
             "needs_review": "needs_review", "rejected": "rejected"}
SPAN_GROUPS = ("new", "changed", "unchanged", "missing")


class ApplyError(Exception):
    def __init__(self, status: int, message: str):
        self.status, self.message = status, message


# ---- the one-time switch --------------------------------------------------------------------------------------

def import_state(db: Session) -> dict[str, Any]:
    row = db.execute(text(
        "SELECT d.created_at, d.reason, u.username FROM data_edits d JOIN users u ON u.id = d.user_id WHERE d.entity = 'system' "
        "AND d.entity_id = 0 AND d.field = 'reservation_import' AND d.new_value = 'closed' ORDER BY d.id LIMIT 1")).first()
    return {"closed": row is not None, "closed_at": row[0] if row else None, "closed_by": row[2] if row else None,
            "reason": row[1] if row else None}


def close_import(db: Session, admin_id: int, reason: str) -> dict[str, Any]:
    if not (reason or "").strip():
        raise ApplyError(422, "A reason is required")
    db.execute(text("SELECT pg_advisory_xact_lock(7001)"))  # two simultaneous closes: the second sees the first
    if import_state(db)["closed"]:
        raise ApplyError(409, "Reservation import is already closed")
    db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id) "
                    "VALUES ('system', 0, 'reservation_import', 'open', 'closed', :r, :u)"), {"r": reason.strip(), "u": admin_id})
    db.commit()
    return import_state(db)


# ---- evaluate -------------------------------------------------------------------------------------------------

@dataclass
class Row:
    n: int
    sheet: str
    raw: dict[str, Any]
    p: dict[str, Any]
    parse_status: str
    parse_reason: str | None
    id: int | None = None
    status: str = "ready"
    reason: str | None = None
    group: str = ""
    warnings: list[str] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class SpanItem:
    key: str
    a: str
    b: str
    rows: list[int]
    vals: dict[str, Any]
    span_id: int | None = None
    group: str = "unchanged"
    changes: list[dict[str, Any]] = field(default_factory=list)
    measurements: list[dict[str, Any]] = field(default_factory=list)
    survey: int | None = None  # surveyed cores after this upload is applied
    db_survey: int | None = None
    db_free: int = 0
    warnings: list[str] = field(default_factory=list)
    used: int = 0


@dataclass
class Eval:
    rows: list[Row]
    spans: dict[str, SpanItem]
    missing: list[dict[str, Any]]
    warnings: list[dict[str, Any]]
    closed: bool

    def counts(self) -> dict[str, int]:
        c = dict.fromkeys(GROUPS, 0)
        for r in self.rows:
            c[r.group] += 1
        for s in self.spans.values():
            c[s.group] += 1
        c["missing"] = len(self.missing)
        return c


def from_results(results: list[RowResult]) -> list[Row]:
    return [Row(r.row_number, r.sheet, r.raw, r.parsed, r.status, r.reason) for r in results]


def _protected(db: Session) -> set[tuple[int, str]]:
    return {(i, f) for i, f in db.execute(text("SELECT entity_id, field FROM data_edits WHERE entity = 'span' AND reason NOT LIKE :r"),
                                          {"r": REASON + "%"})}


def _num_same(a: Any, b: Any) -> bool:
    return a == b or (a is not None and b is not None and not isinstance(a, str) and round(float(a), 3) == round(float(b), 3)) \
        or (a is not None and b is not None and str(a) == str(b))


def _span_items(db: Session, rows: list[Row], sites: dict[str, int], wins: set[tuple[str, str]]) -> dict[str, SpanItem]:
    spans: dict[str, SpanItem] = {}
    for r in rows:
        if r.group:
            continue
        key = "-".join(sorted((r.p["site_a"], r.p["site_b"])))
        sp = spans.setdefault(key, SpanItem(key, r.p["site_a"], r.p["site_b"], [], {}))
        sp.rows.append(r.n)
        r.extra["span_key"] = key
        for f in SPAN_FIELDS:
            v = r.p.get(f)
            if v is None:
                continue
            if f not in sp.vals:
                sp.vals[f] = v
            elif not _num_same(sp.vals[f], v):
                sp.warnings.append(f"rows disagree on {f}: {sp.vals[f]} vs {v} (row {r.n}); the first is used")
        if r.p.get("loss_db") is not None:
            m = {"loss_db": r.p["loss_db"], "tested_on": r.p.get("tested_on"), "row_number": r.n}
            if not any(_num_same(x["loss_db"], m["loss_db"]) and x["tested_on"] == m["tested_on"] for x in sp.measurements):
                sp.measurements.append(m)
    protected = _protected(db)
    for sp in spans.values():
        sid = find_span(db, sites[sp.a], sites[sp.b])
        sp.span_id = sid[0] if sid else None
        if sid is None:
            sp.group, sp.survey = "new", sp.vals.get("survey_cores")
            continue
        old = db.execute(text("SELECT region, distance_km, survey_cores, (SELECT count(*) FROM cores c WHERE c.span_id = :i AND (spans.survey_cores IS NULL OR c.number <= spans.survey_cores)) AS n_cores "
                              "FROM spans WHERE id = :i"), {"i": sid[0]}).mappings().one()
        sp.db_survey = sp.survey = old["survey_cores"]
        sp.db_free = inventory.list_spans(db, None, None, None, sid[0])[0]["free_to_reserve"]
        for f in SPAN_FIELDS:
            new = sp.vals.get(f)
            if new is None or _num_same(old[f], new):
                continue
            prot = (sid[0], f) in protected
            c: dict[str, Any] = {"field": f, "old": None if old[f] is None else (float(old[f]) if f == "distance_km" else old[f]),
                                 "new": new, "protected": prot}
            if prot:
                c["note"] = "edited in dashboard, file differs"
            if f == "survey_cores" and new < old["n_cores"]:
                c["blocked"] = f"cannot lower below the {old['n_cores']} cores that already exist"
            c["applied"] = "blocked" not in c and (not prot or (sp.key, f) in wins)
            if c["applied"] and f == "survey_cores":
                sp.survey = new
            sp.changes.append(c)
        for m in list(sp.measurements):
            if db.execute(text("SELECT 1 FROM measurements WHERE span_id = :s AND loss_db = :l AND tested_on IS NOT DISTINCT FROM "
                               "CAST(:t AS date)"), {"s": sid[0], "l": m["loss_db"], "t": m["tested_on"]}).first():
                sp.measurements.remove(m)
    for sp in spans.values():
        if sp.span_id and (sp.changes or sp.measurements):
            sp.group = "changed"
    return spans


def _flags(p: dict[str, Any]) -> dict[str, Any]:
    return {"cust": p["customer"], "pd": p["planned_date"], "gl": p["group_label"], "ad": bool(p["additional"])}


_SAME = ("SELECT r.id, lower(cu.name) = lower(:cust) AS c, r.planned_date IS NOT DISTINCT FROM CAST(:pd AS date) AS d, "
         "r.group_label IS NOT DISTINCT FROM CAST(:gl AS text) AS l, coalesce(r.additional, false) = :ad AS a "
         "FROM reservations r JOIN customers cu ON cu.id = r.customer_id WHERE ")


def _matches(db: Session, where: str, **p: Any) -> tuple[list[int], list[int]]:
    """(reservations equal on customer, date, label, additional; reservations equal on the where clause only)."""
    rows = db.execute(text(_SAME + where), p).all()
    return [r[0] for r in rows if all(r[1:])], [r[0] for r in rows]


def _set(r: Row, group: str, reason: str | None = None) -> None:
    r.group, r.reason = group, reason or r.reason
    r.status = {"needs_review": "needs_review", "rejected": "rejected"}.get(group, "ready")


def _reservation_row(db: Session, r: Row, sp: SpanItem, sites: dict[str, int], closed: bool, claims: dict[tuple, int],
                     count_rows: dict[tuple, int]) -> None:
    p = r.p
    if closed:
        return _set(r, "ignored", "reservation import is closed; reservation rows are ignored")
    r.extra["cores"] = 0
    if p["planned_date"] is None:
        r.warnings.append("no reserved date: the import date starts the stale clock")
    n = p["unassigned_cores"]
    if n < 1:  # parser left it Needs review already; defensive
        return _set(r, "needs_review", "no core count")
    if sp.span_id:
        full, _ = _matches(db, "r.unassigned_cores = :n AND r.unassigned_span_id = :s", n=n, s=sp.span_id, **_flags(p))
        if full:
            r.extra["matched_reservation_id"] = full[0]
            return _set(r, "already_imported", f"already imported as reservation #{full[0]}")
    ident = (sp.key, n, p["customer"].casefold(), p["planned_date"], p["group_label"], bool(p["additional"]))
    if ident in count_rows:
        return _set(r, "needs_review", f"identical to row {count_rows[ident]} in this file")
    if sp.survey is None:
        return _set(r, "needs_review", "span is not surveyed: a count-only reservation cannot be booked")
    free = (sp.db_free if sp.span_id else 0) + max(sp.survey - (sp.db_survey or 0), 0) - sp.used
    if n > free:
        return _set(r, "needs_review", f"{n} cores requested but only {max(free, 0)} free to reserve on this span")
    count_rows[ident] = r.n
    sp.used += n
    _set(r, "reservations")


def evaluate(db: Session, rows: list[Row], wins: set[tuple[str, str]] = frozenset()) -> Eval:  # type: ignore[assignment]
    closed = import_state(db)["closed"]
    names = {n for r in rows for n in (r.p.get("site_a"), r.p.get("site_b")) if n}
    sites = dict(db.execute(text("SELECT name, id FROM sites WHERE name = ANY(CAST(:n AS text[]))"), {"n": sorted(names)}).all())
    warns: list[dict[str, Any]] = []
    for r in rows:
        r.group = {"rejected": "rejected", "needs_review": "needs_review"}.get(r.parse_status, "")
        r.reason = r.parse_reason
        if not r.group and (unknown := [c for c in (r.p["site_a"], r.p["site_b"]) if c not in sites]):
            _set(r, "rejected", "unknown site " + ", ".join(unknown))
    spans = _span_items(db, rows, sites, wins)
    claims: dict[tuple, int] = {}
    count_rows: dict[tuple, int] = {}
    for r in rows:
        if not r.group:
            _reservation_row(db, r, spans[r.extra["span_key"]], sites, closed, claims, count_rows)
    file_keys = set(spans)
    missing = [{"key": k, "span_id": i} for i, k in db.execute(text(
        "SELECT s.id, CASE WHEN a.name COLLATE \"C\" < b.name COLLATE \"C\" THEN a.name || '-' || b.name ELSE b.name || '-' || a.name END "
        "FROM spans s JOIN sites a ON a.id = s.site_a_id JOIN sites b ON b.id = s.site_b_id ORDER BY s.id")) if k not in file_keys]
    _warnings(rows, spans, closed, warns)
    return Eval(rows, spans, missing, warns, closed)


def _warnings(rows: list[Row], spans: dict[str, SpanItem], closed: bool, warns: list[dict[str, Any]]) -> None:
    def add(kind: str, message: str, nums: list[int]) -> None:
        warns.append({"kind": kind, "message": message, "rows": nums})

    if closed:
        n = [r.n for r in rows if r.group == "ignored"]
        add("import_closed", f"Reservation import is closed: {len(n)} reservation rows are ignored.", n)
    for sp in spans.values():
        firsts = [r.n for r in rows if r.extra.get("span_key") == sp.key and not r.p.get("additional")]
        if len(firsts) > 1:
            add("duplicate_cable", f"Cable {sp.key} looks listed twice (rows {', '.join(map(str, firsts))}).", firsts)
        for w in sp.warnings:
            add("span_values", f"{sp.key}: {w}", sp.rows)
    for r in rows:
        if r.group == "conflicts":
            add("core_held", f"Row {r.n}: {r.reason}", [r.n])
        for w in r.warnings:
            add("row", f"Row {r.n}: {w}", [r.n])


# ---- stage ----------------------------------------------------------------------------------------------------

def _dump(o: Any) -> Any:
    return json.loads(json.dumps(o, default=lambda v: v.isoformat() if isinstance(v, (date, datetime)) else float(v)))


def _row_payload(r: Row) -> dict[str, Any]:
    p = r.p
    shown = None
    if p.get("site_a"):
        shown = {"customer": p.get("customer"), "span": f"{p['site_a']}-{p['site_b']}", "cores": r.extra.get("cores", 0),
                 "count_only": p.get("unassigned_cores") or None, "planned_date": p.get("planned_date"),
                 "group_label": p.get("group_label"), "additional": p.get("additional")}
    return _dump({"group": r.group, "parse_status": r.parse_status, "parse_reason": r.parse_reason, "parsed": p,
                  "reservation": shown, **{k: v for k, v in r.extra.items() if k != "cores"}})


def _span_payload(sp: SpanItem) -> dict[str, Any]:
    return _dump({"group": sp.group, "key": sp.key, "span_id": sp.span_id, "rows": sp.rows, "fields": sp.vals,
                  "changes": sp.changes, "measurements": sp.measurements, "survey_cores_after": sp.survey,
                  "edited_in_dashboard": any(c["protected"] for c in sp.changes), "warnings": sp.warnings})


def stage(db: Session, admin_id: int, filename: str, results: list[RowResult], ignored: list[str]) -> dict[str, Any]:
    ev = evaluate(db, from_results(results))
    warnings = ([{"kind": "ignored_sheet", "rows": [], "message": "Sheets left out of this upload (sites come from the site "
                  "master upload): " + ", ".join(ignored)}] if ignored else []) + ev.warnings
    summary = {"counts": ev.counts(), "warnings": warnings, "switch_closed": ev.closed, "ignored_sheets": ignored, "applied": None}
    uid = db.execute(text("INSERT INTO uploads (user_id, filename, kind, status, summary) VALUES (:u, :f, 'excel', 'staged', "
                          "CAST(:s AS jsonb)) RETURNING id"), {"u": admin_id, "f": filename, "s": json.dumps(summary)}).scalar_one()
    out = []
    for r in ev.rows:
        out.append({"u": uid, "g": ROW_GROUP[r.group], "e": "reservation" if r.group in ("reservations", "conflicts", "already_imported", "ignored")
                    else "row", "p": json.dumps(_row_payload(r)), "w": json.dumps(r.warnings),
                    "sh": r.sheet, "n": r.n, "st": r.status, "r": r.reason, "raw": json.dumps(r.raw)})
    first = {r.extra["span_key"]: r for r in reversed(ev.rows) if r.extra.get("span_key")}
    for sp in ev.spans.values():
        out.append({"u": uid, "g": ROW_GROUP[sp.group], "e": "span", "p": json.dumps(_span_payload(sp)), "w": json.dumps(sp.warnings),
                    "sh": "Reservation", "n": sp.rows[0], "st": "ready", "r": None, "raw": json.dumps(first[sp.key].raw)})
    for m in ev.missing:
        out.append({"u": uid, "g": "missing", "e": "span", "p": json.dumps({"group": "missing", **m}), "w": "[]", "sh": None,
                    "n": None, "st": None, "r": None, "raw": None})
    if out:
        db.execute(text("INSERT INTO upload_rows (upload_id, row_group, entity, payload, warnings, sheet, row_number, status, reason, raw) "
                        "VALUES (:u, :g, :e, CAST(:p AS jsonb), CAST(:w AS jsonb), :sh, :n, :st, :r, CAST(:raw AS jsonb))"), out)
    db.commit()
    return {"upload_id": uid, "filename": filename, "status": "staged", **summary}


def _unjson(p: dict[str, Any]) -> dict[str, Any]:
    p = dict(p)
    for k in ("planned_date", "cv_ready_date", "tested_on"):
        if p.get(k):
            p[k] = date.fromisoformat(p[k])
    return p


def load_staged(db: Session, upload_id: int) -> list[Row]:
    return [Row(r["row_number"], r["sheet"], r["raw"] or {}, _unjson(r["payload"]["parsed"]), r["payload"]["parse_status"],
                r["payload"]["parse_reason"], id=r["id"])
            for r in db.execute(text("SELECT id, row_number, sheet, raw, payload FROM upload_rows WHERE upload_id = :u "
                                     "AND entity <> 'span' ORDER BY row_number"), {"u": upload_id}).mappings()]


# ---- confirm --------------------------------------------------------------------------------------------------

def confirm(db: Session, admin_id: int, upload_id: int, excel_wins: list[dict[str, Any]]) -> dict[str, Any]:
    up = db.execute(text("SELECT id, filename, status, summary FROM uploads WHERE id = :i AND kind = 'excel' FOR UPDATE"),
                    {"i": upload_id}).mappings().first()
    if not up:
        raise ApplyError(404, "Upload not found")
    if up["status"] != "staged":
        raise ApplyError(409, "This upload was already confirmed")
    span_rows = dict(db.execute(text("SELECT id, payload->>'key' FROM upload_rows WHERE upload_id = :u AND entity = 'span' "
                                     "AND row_group <> 'missing'"), {"u": upload_id}).all())
    wins: set[tuple[str, str]] = set()
    for w in excel_wins:
        if w["row_id"] not in span_rows or w["field"] not in SPAN_FIELDS:
            raise ApplyError(422, f"Row {w['row_id']} / field '{w['field']}' is not a span field of this upload")
        wins.add((span_rows[w["row_id"]], w["field"]))
    ev = evaluate(db, load_staged(db, upload_id), wins)
    for key, f in wins:
        if not any(c["field"] == f and c["protected"] for c in ev.spans.get(key, SpanItem(key, "", "", [], {})).changes):
            raise ApplyError(422, f"{key}: '{f}' is not a protected field that differs in the file")
    why = f"{REASON} {up['filename']} #{upload_id}"
    counts: dict[str, int] = {"spans": 0, "cores": 0, "ports": 0, "customers": 0, "reservations": 0, "span_updates": 0,
                              "measurements": 0}
    skipped: list[dict[str, Any]] = []
    sites = dict(db.execute(text("SELECT name, id FROM sites WHERE name = ANY(CAST(:n AS text[]))"),
                            {"n": sorted({n for s in ev.spans.values() for n in (s.a, s.b)})}).all())
    with db.begin_nested():  # all or nothing
        for sp in ev.spans.values():
            if sp.group == "new":
                ensure_span(db, counts, sites[sp.a], sites[sp.b], sp.vals)
            sid = sp.span_id or find_span(db, sites[sp.a], sites[sp.b])[0]  # type: ignore[index]
            for c in sp.changes:
                if not c["applied"]:
                    continue
                db.execute(text(f"UPDATE spans SET {c['field']} = :v WHERE id = :i"), {"v": c["new"], "i": sid})
                db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id) "
                                "VALUES ('span', :i, :f, :o, :n, :r, :u)"),
                           {"i": sid, "f": c["field"], "o": None if c["old"] is None else str(c["old"]), "n": str(c["new"]), "r": why, "u": admin_id})
                if c["field"] == "survey_cores":
                    counts["cores"] += add_cores(db, sid, c["new"])
                counts["span_updates"] += 1
            for m in sp.measurements:
                db.execute(text("INSERT INTO measurements (span_id, loss_db, tested_on, upload_id) VALUES (:s, :l, :t, :u)"),
                           {"s": sid, "l": m["loss_db"], "t": m["tested_on"], "u": upload_id})
                counts["measurements"] += 1
        for r in ev.rows:
            if r.group == "reservations":
                try:
                    with db.begin_nested():
                        place_reservation(db, counts, r.p, sites, admin_id, admin_id)
                except (Skip, IntegrityError) as e:
                    skipped.append({"row_number": r.n, "reason": str(e) or "core already taken"})
        for r in ev.rows:
            if r.group in ("conflicts",):
                skipped.append({"row_number": r.n, "reason": r.reason})
        summary = dict(up["summary"], applied={"by": admin_id, "at": datetime.now(UTC).isoformat(), "counts": counts,
                                               "skipped": skipped, "excel_wins": [list(w) for w in sorted(wins)],
                                               "ignored_reservation_rows": ev.counts()["ignored"]})
        db.execute(text("UPDATE uploads SET status = 'confirmed', confirmed_at = now(), summary = CAST(:s AS jsonb) WHERE id = :i"),
                   {"s": json.dumps(summary), "i": upload_id})
    db.commit()
    invalidate_routes()  # new spans or distances
    return {"upload_id": upload_id, "counts": counts, "skipped": skipped, "warnings": ev.warnings,
            "ignored_reservation_rows": ev.counts()["ignored"]}
