import io
import zipfile
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.db import get_db
from app.map import service

router = APIRouter(prefix="/api/map", dependencies=[Depends(get_current_user)])
DB = Annotated[Session, Depends(get_db)]
KMZ_TYPE = "application/vnd.google-earth.kmz"


@router.get("/segments")
def segments(db: DB) -> dict[str, Any]:
    return service.map_segments(db)


@router.get("/sites")
def sites(db: DB) -> dict[str, Any]:
    return service.map_sites(db)


def _zip_kml(kml: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("doc.kml", kml)
    return buffer.getvalue()


@router.get("/segments/{segment_id}/kmz", response_class=Response)
def segment_kmz(db: DB, segment_id: int) -> Response:
    found = service.segment_kml(db, segment_id)
    if found is None:
        raise HTTPException(404, "Segment not found or has no coordinates")
    name, kml = found
    # filename* carries any non-ASCII site name; the plain filename is the ASCII fallback
    ascii_name = name.encode("ascii", "replace").decode().replace('"', "")
    disposition = f'attachment; filename="{ascii_name}.kmz"; filename*=UTF-8\'\'{quote(name)}.kmz'
    return Response(_zip_kml(kml), media_type=KMZ_TYPE, headers={"Content-Disposition": disposition})
