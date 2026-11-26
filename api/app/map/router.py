import io
import zipfile
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.auth.deps import DB, get_current_user
from app.map import service

router = APIRouter(prefix="/api/map", dependencies=[Depends(get_current_user)])
KMZ_TYPE = "application/vnd.google-earth.kmz"


@router.get("/segments")
def segments(db: DB) -> dict[str, Any]:
    return service.map_segments(db)


@router.get("/sites")
def sites(db: DB) -> dict[str, Any]:
    return service.map_sites(db)


@router.get("/kmz-elements")
def kmz_elements(db: DB) -> dict[str, Any]:
    return service.map_kmz_elements(db)


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
    return kmz_response(*found)


def kmz_response(name: str, kml: str) -> Response:
    # filename* carries any non-ASCII site name; the plain filename is the ASCII fallback
    ascii_name = name.encode("ascii", "replace").decode().replace('"', "")
    disposition = f'attachment; filename="{ascii_name}.kmz"; filename*=UTF-8\'\'{quote(name)}.kmz'
    return Response(_zip_kml(kml), media_type=KMZ_TYPE, headers={"Content-Disposition": disposition})
