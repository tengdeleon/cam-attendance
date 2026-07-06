from fastapi import APIRouter, Depends

from app.deps import current_admin
from app.services import retention_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/purge-selfies")
def purge(_: dict = Depends(current_admin)):
    removed = retention_service.purge_old_selfies()
    return {"removed": removed}
