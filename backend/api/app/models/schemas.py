from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


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


class AttendanceOut(BaseModel):
    id: str
    person_id: str
    direction: Literal["in", "out"]
    selfie_url: str
    logged_by: str
    server_time: datetime


class TodayRow(BaseModel):
    person_id: str
    full_name: str
    role: str
    last_direction: Literal["in", "out"]
    last_time: datetime


class HistoryRow(BaseModel):
    id: str
    person_id: str
    full_name: str
    role: str
    direction: Literal["in", "out"]
    server_time: datetime
