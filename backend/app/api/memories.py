from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_services
from app.models import Memory, User
from app.schemas.memory import MemoryCreate, MemoryOut, MemorySettings, MemoryUpdate
from app.services.container import Services
from app.services.mag.service import MemoryRejected

router = APIRouter(prefix="/memories", tags=["memories"])


def _owned(db: Session, services: Services, user: User, memory_id: int) -> Memory:
    memory = services.mag.get_for_user(db, user.id, memory_id)
    if memory is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")
    return memory


@router.get("", response_model=list[MemoryOut])
def list_memories(
    user: User = Depends(get_current_user), db: Session = Depends(get_db), services: Services = Depends(get_services)
):
    services.mag.purge_expired(db)
    return services.mag.list_for_user(db, user.id)


@router.get("/settings", response_model=MemorySettings)
def memory_settings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db), services: Services = Depends(get_services)
):
    return MemorySettings(
        memory_enabled=user.memory_enabled,
        retention_days=services.settings.memory_retention_days,
        max_memories=services.settings.memory_max_per_user,
        count=services.mag.count_for_user(db, user.id),
    )


@router.post("", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
def create_memory(
    payload: MemoryCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    if not user.memory_enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Enable memory in your settings first.")
    try:
        return services.mag.create(db, user, payload.category, payload.content, "manual")
    except MemoryRejected as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/{memory_id}", response_model=MemoryOut)
def get_memory(
    memory_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    return _owned(db, services, user, memory_id)


@router.patch("/{memory_id}", response_model=MemoryOut)
def update_memory(
    memory_id: int,
    payload: MemoryUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    memory = _owned(db, services, user, memory_id)
    try:
        return services.mag.update(db, memory, payload.category, payload.content)
    except MemoryRejected as exc:
        raise HTTPException(422, str(exc)) from exc


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_memory(
    memory_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    db.delete(_owned(db, services, user, memory_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_memories(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.execute(delete(Memory).where(Memory.user_id == user.id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
