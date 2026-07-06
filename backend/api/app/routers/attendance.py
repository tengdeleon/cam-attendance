from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, UploadFile

from app.deps import current_teacher
from app.models.schemas import AttendanceIn, AttendanceOut, TodayRow
from app.services import attendance_service

router = APIRouter(prefix="/attendance", tags=["attendance"])


@router.post("", response_model=AttendanceOut, status_code=201)
async def log_attendance(
    person_id: str = Form(...),
    direction: str = Form(...),
    device_time: Optional[datetime] = Form(default=None),
    selfie: UploadFile = File(...),
    teacher: dict = Depends(current_teacher),
):
    payload = AttendanceIn(person_id=person_id, direction=direction, device_time=device_time)
    content = await selfie.read()
    return attendance_service.record_attendance(payload, content, teacher["id"])


@router.get("/today", response_model=list[TodayRow])
def today(_: dict = Depends(current_teacher)):
    return attendance_service.today_board()
