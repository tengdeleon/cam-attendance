import secrets as pysecrets

from fastapi import APIRouter, Depends, Header, HTTPException, status

from app.config import settings
from app.deps import current_admin, current_teacher
from app.services import retention_service

router = APIRouter(prefix="/admin", tags=["admin"])


@router.delete("/people/{person_id}")
def erase_person(person_id: str, _: dict = Depends(current_admin)):
    """RA 10173 deletion request: person + attendance + all selfies, permanently."""
    return retention_service.erase_person(person_id)


async def admin_or_cron(
    authorization: str = Header(default=""),
    x_cron_key: str = Header(default=""),
) -> None:
    """Allow either a signed-in admin OR a scheduled job with the shared key."""
    if (
        settings.cron_secret
        and x_cron_key
        and pysecrets.compare_digest(x_cron_key, settings.cron_secret)
    ):
        return
    teacher = await current_teacher(authorization)  # raises 401 if no/bad token
    if not teacher.get("is_admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")


@router.post("/purge-selfies")
async def purge(_: None = Depends(admin_or_cron)):
    removed = retention_service.purge_old_selfies()
    return {"removed": removed}
