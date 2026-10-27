import os

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from alembic import command

_base = make_url(os.environ["DATABASE_URL"])
TEST_URL = _base.set(database="fiber_test").render_as_string(hide_password=False)


def alembic_cfg() -> Config:
    os.environ["ALEMBIC_DATABASE_URL"] = TEST_URL  # read by alembic/env.py
    return Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))


@pytest.fixture(scope="session")
def engine():
    admin = create_engine(
        _base.set(database="postgres").render_as_string(hide_password=False),
        isolation_level="AUTOCOMMIT", poolclass=NullPool,
    )
    with admin.connect() as c:
        c.execute(text("DROP DATABASE IF EXISTS fiber_test WITH (FORCE)"))
        c.execute(text("CREATE DATABASE fiber_test"))
    command.upgrade(alembic_cfg(), "head")
    eng = create_engine(TEST_URL, poolclass=NullPool)
    yield eng
    eng.dispose()


@pytest.fixture
def db(engine):
    with engine.connect() as conn:
        outer = conn.begin()
        yield conn
        outer.rollback()


@pytest.fixture
def client(db):
    from fastapi.testclient import TestClient

    from app.db import get_db
    from app.main import app

    def override():
        with Session(bind=db) as s:
            yield s

    app.dependency_overrides[get_db] = override
    yield TestClient(app)
    app.dependency_overrides.clear()
