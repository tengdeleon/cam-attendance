from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class TeacherIn(BaseModel):
    """Admin provisions a new teacher who can log in with email + password."""

    full_name: str = Field(min_length=1)
    email: str = Field(min_length=3, description="Login email for the new teacher")
    password: str = Field(min_length=8, description="Initial password assigned by admin")
    is_admin: bool = False


class TeacherOut(BaseModel):
    person_id: str
    teacher_account_id: str
    auth_user_id: str
    full_name: str
    email: str
    is_admin: bool


class PersonIn(BaseModel):
    full_name: str
    role: Literal["teacher", "student"]
    photo_url: Optional[str] = None


class PersonOut(PersonIn):
    id: str
    is_active: bool
    created_at: datetime


class AttendanceIn(BaseModel):
    person_id: str
    direction: Literal["in", "out"]
    device_time: Optional[datetime] = None
    # selfie is uploaded as multipart file alongside this payload


class AttendanceWarning(BaseModel):
    code: Literal["missed_checkout"]
    date: str  # Manila-local date, YYYY-MM-DD


class AttendanceOut(BaseModel):
    id: str
    person_id: str
    direction: Literal["in", "out"]
    logged_by: str
    server_time: datetime
    warnings: list[AttendanceWarning] = []
    # selfie_url deliberately omitted: the raw bucket path is never returned to the
    # client. Image access goes through GET /attendance/{id}/selfie (signed URL only).


class TodayRow(BaseModel):
    person_id: str
    full_name: str
    role: str
    last_direction: Literal["in", "out"]
    last_time: datetime
    last_attendance_id: str


class SelfieUrlOut(BaseModel):
    url: str
    expires_in: int


class HistoryRow(BaseModel):
    id: str
    person_id: str
    full_name: str
    role: str
    direction: Literal["in", "out"]
    server_time: datetime


class DailyDetail(BaseModel):
    date: str            # YYYY-MM-DD
    first_in: str        # HH:MM:SS Manila-local
    late_minutes: int
    missed_checkout: bool


class PeriodReportRow(BaseModel):
    person_id: str
    full_name: str
    days_present: int
    late_days: int
    total_late_minutes: int
    missed_checkouts: int
    daily_detail: list[DailyDetail]


class CenterSettingsOut(BaseModel):
    open_time: str        # HH:MM:SS
    grace_minutes: int
    tz: str


class CenterSettingsPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    open_time: Optional[str] = None
    grace_minutes: Optional[int] = None
    tz: Optional[str] = None
