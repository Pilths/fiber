"""Report on a workbook without touching the database. Run: python -m app.ingest.excel_check <file>"""
import sys
from collections import Counter

from app.ingest.excel import parse_workbook


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.ingest.excel_check <file>")
    rows = parse_workbook(sys.argv[1])
    for sheet in dict.fromkeys(r.sheet for r in rows):
        mine = [r for r in rows if r.sheet == sheet]
        print(f"{sheet}: {len(mine)} rows")
        for r in mine:
            if r.status != "ready":
                print(f"  row {r.row_number} [{r.status}] {r.reason}")
        counts = Counter(r.status for r in mine)
        print("  " + ", ".join(f"{s}: {counts.get(s, 0)}" for s in ("ready", "needs_review", "rejected")))


if __name__ == "__main__":
    main()
