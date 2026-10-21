import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)


def get_db() -> Iterator[Session]:
    with Session(engine) as session:
        yield session
