"""Create the first (or another) admin account from the command line.

    docker compose exec api python -m app.create_admin admin1 "Display Name"

Asks for the password twice (hidden, never on the command line), so it stays out of shell history.
The account is kept in history like any other edit, attributed to itself (there is no admin yet to blame).
"""
import sys
from getpass import getpass

from sqlalchemy.orm import Session

from app.auth.router import MIN_PASSWORD
from app.auth.users import UsernameTaken, create_user_account, log_user_edit
from app.db import engine


def main(argv: list[str]) -> int:
    if not 1 <= len(argv) <= 2 or not argv[0].strip():
        print('usage: python -m app.create_admin USERNAME ["Display name"]')
        return 2
    username = argv[0].strip()
    display_name = argv[1].strip() if len(argv) == 2 else username
    password = getpass(f"Password for {username} (at least {MIN_PASSWORD} characters): ")
    if len(password) < MIN_PASSWORD:
        print(f"Password must be at least {MIN_PASSWORD} characters.")
        return 1
    if getpass("Repeat password: ") != password:
        print("Passwords do not match.")
        return 1
    with Session(engine) as db:
        try:
            user_id = create_user_account(db, username, display_name, "admin", password, must_change_password=False)
        except UsernameTaken:
            print(f"Username {username} already exists.")
            return 1
        log_user_edit(db, user_id, user_id, "account", None, "created as admin", "created from the command line")
        db.commit()
    print(f"Admin {username} created. Sign in on the web page.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
