"""Admin export of live Sites and Segments as a locked workbook."""
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Response

from app.auth.deps import DB, require_admin
from app.ingest.export_xlsx import build_workbook

router = APIRouter(prefix="/api/admin/export", dependencies=[Depends(require_admin)])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/fiber-data.xlsx")
def export_fiber_data(db: DB) -> Response:
    stamp = datetime.now(ZoneInfo("Asia/Kuala_Lumpur")).strftime("%Y-%m-%d")
    return Response(build_workbook(db), media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="fiber-data-{stamp}.xlsx"'})
