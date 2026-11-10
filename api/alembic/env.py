import os

from alembic import context
from app.models import Base
from sqlalchemy import create_engine

# URL precedence: `-x dburl=...`, then ALEMBIC_DATABASE_URL, then DATABASE_URL.
url = (
    context.get_x_argument(as_dictionary=True).get("dburl")
    or os.environ.get("ALEMBIC_DATABASE_URL")
    or os.environ["DATABASE_URL"]
)

# PostGIS owns spatial_ref_sys; it is not part of our schema, so autogenerate and `alembic check` skip it.
POSTGIS_TABLES = {"spatial_ref_sys"}


def include_object(object, name, type_, reflected, compare_to):
    is_postgis_table = type_ == "table" and name in POSTGIS_TABLES
    return not is_postgis_table


if context.is_offline_mode():
    context.configure(
        url=url, target_metadata=Base.metadata, literal_binds=True, include_object=include_object
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(url).connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata, include_object=include_object)
        with context.begin_transaction():
            context.run_migrations()
