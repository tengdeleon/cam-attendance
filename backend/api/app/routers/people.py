from fastapi import APIRouter, Depends

from app.db import get_supabase
from app.deps import current_admin, current_teacher
from app.models.schemas import PersonIn, PersonOut

router = APIRouter(prefix="/people", tags=["people"])


@router.get("", response_model=list[PersonOut])
def list_people(_: dict = Depends(current_teacher)):
    sb = get_supabase()
    return sb.table("people").select("*").eq("is_active", True).order("full_name").execute().data


@router.post("", response_model=PersonOut, status_code=201)
def create_person(body: PersonIn, _: dict = Depends(current_admin)):
    sb = get_supabase()
    return sb.table("people").insert(body.model_dump()).execute().data[0]


@router.patch("/{person_id}", response_model=PersonOut)
def update_person(person_id: str, body: PersonIn, _: dict = Depends(current_admin)):
    sb = get_supabase()
    return sb.table("people").update(body.model_dump()).eq("id", person_id).execute().data[0]


@router.delete("/{person_id}", status_code=204)
def deactivate_person(person_id: str, _: dict = Depends(current_admin)):
    sb = get_supabase()
    sb.table("people").update({"is_active": False}).eq("id", person_id).execute()
