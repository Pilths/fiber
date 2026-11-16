"""Admin editing: core ports, measured loss, segment fields, site fields, and data_edits history."""
from fastapi import APIRouter, Depends

# ports first: it loads app.inventory before app.reservations.service, which avoids a circular import
from app.admin_edits import history, ports, measurements, segments, sites  # noqa: I001
from app.auth.deps import require_admin

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])
router.include_router(history.router)
router.include_router(ports.router)
router.include_router(measurements.router)
router.include_router(segments.router)
router.include_router(sites.router)
