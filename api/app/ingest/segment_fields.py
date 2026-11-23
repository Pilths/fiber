"""The one place an upload changes a segment column: compare, update, and keep the history row."""
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.admin_edits.history import log_edits_for_user

# The only columns an upload may write, with the type each value is cast to. The column name in the SQL
# comes from this table, never from the file.
FIELD_TYPES = {
    "region": "text",
    "distance_km": "numeric",
    "route": "text",
    "section": "text",
    "survey_cores": "integer",
}
NUMBER_FIELDS = ("distance_km", "survey_cores")


def same_value(field_name: str, old: Any, new: Any) -> bool:
    """Numbers compare as numbers, so 12 equals 12.000."""
    if old is None or new is None:
        return old is None and new is None
    if field_name in NUMBER_FIELDS:
        return Decimal(str(old)) == Decimal(str(new))
    return str(old) == str(new)


def write_segment_field(
    db: Session,
    admin_id: int,
    upload_id: int | None,
    segment_id: int,
    field_name: str,
    old: Any,
    new: Any,
    remarks: str,
) -> bool:
    """Set one segment column and add its history row. Returns False and writes nothing when the value is the same."""
    column_type = FIELD_TYPES[field_name]
    if same_value(field_name, old, new):
        return False
    update_sql = f"UPDATE segments SET {field_name} = CAST(:value AS {column_type}) WHERE id = :segment_id"
    db.execute(text(update_sql), {"value": new, "segment_id": segment_id})
    log_edits_for_user(db, admin_id, "segment", segment_id, [(field_name, old, new)], remarks, upload_id)
    return True
