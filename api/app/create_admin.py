"""Create the first (or another) admin account from the command line.

    docker compose exec api python -m app.create_admin admin1 "Display Name"

Asks for the password twice (hidden, never on the command line), so it stays out of shell history.
The account is kept in history like any other edit, attributed to itself (there is no admin yet to blame).
"""
import sys
from getpass import getpass

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.router import MIN_PASSWORD, ph
from app.db import engine


def main(argv: list[str]) -> int:
    if not 1 <= len(argv) <= 2 or not argv[0].strip():
        print('usage: python -m app.create_admin USERNAME ["Display name"]')
        return 2
    name, display = argv[0].strip(), (argv[1].strip() if len(argv) == 2 else argv[0].strip())
    pw = getpass(f"Password for {name} (at least {MIN_PASSWORD} characters): ")
    if len(pw) < MIN_PASSWORD:
        print(f"Password must be at least {MIN_PASSWORD} characters.")
        return 1
    if getpass("Repeat password: ") != pw:
        print("Passwords do not match.")
        return 1
    with Session(engine) as db:
        if db.execute(text("SELECT 1 FROM users WHERE username = :u"), {"u": name}).first():
            print(f"Username {name} already exists.")
            return 1
        uid = db.execute(text("INSERT INTO users (username, display_name, role, password_hash, must_change_password) "
                              "VALUES (:u, :d, 'admin', :h, false) RETURNING id"),
                         {"u": name, "d": display, "h": ph.hash(pw)}).scalar_one()
        db.execute(text("INSERT INTO data_edits (entity, entity_id, field, old_value, new_value, reason, user_id) "
                        "VALUES ('user', :i, 'account', NULL, 'created as admin', 'created from the command line', :i)"), {"i": uid})
        db.commit()
    print(f"Admin {name} created. Sign in on the web page.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
