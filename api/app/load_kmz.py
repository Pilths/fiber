"""Draw road-shaped segment lines from a Google Earth KMZ.

    docker compose exec api python -m app.load_kmz USERNAME data/file.kmz [--folder "propose route"]

Put the file in api/data/ (git-ignored). Only the lines of one KML folder are read (default "propose route");
site points, existing infrastructure and distance folders are ignored. Lines are matched to segments by their
title AAAA-BBBB (two site names); pieces with the same title are joined into one line. A title that is not a
site pair, or a pair with no segment, is skipped and reported. Safe to run again: the shape of a segment is
updated, not duplicated. The KML inside the file may be at most 50 MB unpacked.
"""
import argparse
import json
import sys

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import engine
from app.ingest.kmz import DEFAULT_FOLDER, SEGMENT_BY_ID_SQL, compute_shapes, parse_lines, save_shape

USER_SQL = "SELECT id FROM users WHERE username = :username AND active"
INSERT_UPLOAD_SQL = """
INSERT INTO uploads (user_id, filename, kind, status, summary, confirmed_at)
VALUES (:user_id, :filename, 'kmz', 'confirmed', CAST(:summary AS jsonb), now())
"""


def run(db: Session, username: str, path: str, folder: str) -> int:
    user_id = db.execute(text(USER_SQL), {"username": username}).scalar()
    if user_id is None:
        print(f"User '{username}' not found or not active.")
        return 1
    try:
        lines, folder_names = parse_lines(path, folder)
    except ValueError as error:
        print(error)
        return 1
    if not lines:
        found = ", ".join(folder_names) or "none"
        print(f"No lines found in folder '{folder}'. Folders in the file: {found}")
        return 1
    result = compute_shapes(db, lines)
    for item in result["shaped"]:
        segment = db.execute(text(SEGMENT_BY_ID_SQL), {"segment_id": item["segment_id"]}).mappings().one()
        save_shape(db, segment, item["coords"])
    shaped = [{key: value for key, value in item.items() if key != "coords"} for item in result["shaped"]]
    summary = {"shaped": shaped, "skipped": result["skipped"]}
    upload = {"user_id": user_id, "filename": path.rsplit("/", 1)[-1], "summary": json.dumps(summary)}
    db.execute(text(INSERT_UPLOAD_SQL), upload)
    db.commit()
    print_report(len(lines), shaped, result["skipped"])
    return 0


def print_report(line_count: int, shaped: list, skipped: list) -> None:
    print(f"Lines read: {line_count}")
    for item in shaped:
        excel = "none" if item["excel_km"] is None else f"{item['excel_km']:.2f} km"
        print(f"{item['name']}: {item['km']:.2f} km drawn (Excel {excel})")
    for item in skipped:
        print(f"Skipped {item['name']}: {item['reason']}")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Draw segment shapes from a KMZ file")
    parser.add_argument("username")
    parser.add_argument("kmz_path")
    parser.add_argument("--folder", default=DEFAULT_FOLDER)
    args = parser.parse_args(argv)
    with Session(engine) as db:
        return run(db, args.username, args.kmz_path, args.folder)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
