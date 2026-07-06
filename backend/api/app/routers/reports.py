from datetime import date

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from app.deps import current_teacher
from app.services import export_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/history.csv", response_class=PlainTextResponse)
def export_history(start: date, end: date, _: dict = Depends(current_teacher)):
    csv_text = export_service.history_csv(start, end)
    return PlainTextResponse(
        csv_text,
        headers={"Content-Disposition": f"attachment; filename=attendance_{start}_{end}.csv"},
    )
