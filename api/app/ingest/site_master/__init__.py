"""Site master workbook (replace-file model).

Find sheets by headers, parse, diff against the database, stage, apply.

Staging writes only `uploads` and `upload_rows`. Apply recomputes the diff from the staged rows against the
current database, so a stale preview cannot overwrite newer data.

Modules: model (constants, types), parse (read the workbook), evaluate (compare with the database),
stage (upload_rows), apply (write the sites).
"""
from app.ingest.site_master.apply import ApplyError, apply_sheet, apply_upload
from app.ingest.site_master.evaluate import load_protected
from app.ingest.site_master.model import GROUP_COL, SHEETS, hkey
from app.ingest.site_master.parse import parse_workbook
from app.ingest.site_master.stage import stage

__all__ = [
    "GROUP_COL",
    "SHEETS",
    "ApplyError",
    "apply_sheet",
    "apply_upload",
    "hkey",
    "load_protected",
    "parse_workbook",
    "stage",
]
