from datetime import date

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse

from app.db import get_supabase
from app.deps import current_teacher
from app.models.schemas import HistoryRow, PeriodReportRow
from app.services import attendance_service, export_service, reports_service

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


@router.get("/period", response_model=list[PeriodReportRow])
def period(month: str, period: str, _: dict = Depends(current_teacher)):
    return reports_service.period_report(get_supabase(), month, period)


@router.get("/period.csv", response_class=PlainTextResponse)
def export_period(month: str, period: str, _: dict = Depends(current_teacher)):
    csv_text = reports_service.period_report_csv(get_supabase(), month, period)
    safe_period = period.replace("/", "_")
    return PlainTextResponse(
        csv_text,
        headers={
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": f'attachment; filename="period_report_{month}_{safe_period}.csv"',
        },
    )
