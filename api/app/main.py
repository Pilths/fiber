from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

app = FastAPI(title="Fiber Dashboard API")


@app.get("/api/health")
def health(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    postgis = db.execute(text("SELECT postgis_version()")).scalar_one()
    return {"status": "ok", "postgis": postgis}
