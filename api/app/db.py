import os
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)


def get_db() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


# How long a request waits for a row lock held by another request before it gives up with 409 (see main.py).
LOCK_TIMEOUT = "5s"
SET_LOCK_TIMEOUT_SQL = "SELECT set_config('lock_timeout', :timeout, true)"  # true = this transaction only


def set_lock_timeout(db: Session) -> None:
    db.execute(text(SET_LOCK_TIMEOUT_SQL), {"timeout": LOCK_TIMEOUT})
