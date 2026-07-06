from datetime import date

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from app.deps import current_teacher
from app.models.schemas import HistoryRow
from app.services import attendance_service, export_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/history", response_model=list[HistoryRow])
def history(start: date, end: date, _: dict = Depends(current_teacher)):
    """Attendance rows for Manila-local days [start, end], newest first."""
    return attendance_service.history(start, end)


@router.get("/history.csv", response_class=PlainTextResponse)
def export_history(start: date, end: date, _: dict = Depends(current_teacher)):
    csv_text = export_service.history_csv(start, end)
    return PlainTextResponse(
        csv_text,
        headers={"Content-Disposition": f"attachment; filename=attendance_{start}_{end}.csv"},
    )
