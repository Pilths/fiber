import os

from sqlalchemy import create_engine

from alembic import context
from app.models import Base

# URL precedence: `-x dburl=...`, then ALEMBIC_DATABASE_URL, then DATABASE_URL.
url = (
    context.get_x_argument(as_dictionary=True).get("dburl")
    or os.environ.get("ALEMBIC_DATABASE_URL")
    or os.environ["DATABASE_URL"]
)

if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(url).connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
