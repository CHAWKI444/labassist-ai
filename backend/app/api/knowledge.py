from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_services, require_admin, require_staff
from app.models import KnowledgeBaseVersion, KnowledgeItem, User
from app.models.base import utcnow
from app.models.knowledge import KnowledgeStatus
from app.schemas.knowledge import CagStatus, KnowledgeItemCreate, KnowledgeItemOut, KnowledgeItemUpdate
from app.services.cag.service import KV_CACHE_EXPLANATION
from app.models.notification import NotificationType
from app.models.notification import NotificationType
from app.services.container import Services
from app.services.notifications import active_user_ids, notify
from app.services.notifications import active_user_ids, notify, notify_users

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _get(db: Session, item_id: int) -> KnowledgeItem:
    item = db.get(KnowledgeItem, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Knowledge item not found")
    return item


@router.get("", response_model=list[KnowledgeItemOut])
def list_items(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    return db.scalars(select(KnowledgeItem).order_by(KnowledgeItem.priority, KnowledgeItem.id)).all()


@router.post("", response_model=KnowledgeItemOut, status_code=status.HTTP_201_CREATED)
def create_item(payload: KnowledgeItemCreate, user: User = Depends(require_staff), db: Session = Depends(get_db)):
    item = KnowledgeItem(**payload.model_dump(), status=KnowledgeStatus.DRAFT, created_by=user.id)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=KnowledgeItemOut)
def update_item(
    item_id: int,
    payload: KnowledgeItemUpdate,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    item = _get(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return item
    was_approved = item.status == KnowledgeStatus.APPROVED
    for key, value in changes.items():
        setattr(item, key, value)
    item.revision += 1
    if was_approved and not user.is_admin:
        # Staff edits to approved content must be re-approved before reaching the CAG context.
        item.status = KnowledgeStatus.DRAFT
        item.approved_by = None
        item.approved_at = None
        for admin_id in active_user_ids(db, ["admin"]):
            notify(db, admin_id, NotificationType.EVENT, "Knowledge entry needs re-approval",
                   f"KB{item.id} “{item.title}” was edited by {user.full_name} and returned to draft.",
                   "/staff/knowledge", commit=False)
    db.commit()
    db.refresh(item)
    if was_approved:
        services.cag.bump_version(db, f"Item {item.id} edited", user.id)
        if item.status == KnowledgeStatus.DRAFT:
            notify_users(db, active_user_ids(db, ["admin"]), NotificationType.EVENT, "Knowledge entry needs re-approval",
                         f"{user.full_name} edited approved entry KB{item.id} “{item.title}”. It was removed from the "
                         "CAG context until re-approved.", "/staff/knowledge")
    return item


def _set_status(db: Session, services: Services, item: KnowledgeItem, new_status: str, user: User) -> KnowledgeItem:
    if item.status == new_status:
        return item
    affects_cag = KnowledgeStatus.APPROVED in (item.status, new_status)
    item.status = new_status
    if new_status == KnowledgeStatus.APPROVED:
        item.approved_by = user.id
        item.approved_at = utcnow()
        if item.created_by and item.created_by != user.id:
            notify(db, item.created_by, NotificationType.EVENT, "Knowledge entry approved",
                   f"KB{item.id} “{item.title}” is now part of the approved context.", "/staff/knowledge",
                   commit=False)
    db.commit()
    db.refresh(item)
    if affects_cag:
        services.cag.bump_version(db, f"Item {item.id} {new_status}", user.id)
    if new_status == KnowledgeStatus.APPROVED and item.created_by and item.created_by != user.id:
        notify(db, item.created_by, NotificationType.EVENT, "Knowledge entry approved",
               f"KB{item.id} “{item.title}” is now part of the approved CAG context.", "/staff/knowledge")
    return item


@router.post("/{item_id}/approve", response_model=KnowledgeItemOut)
def approve_item(
    item_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    return _set_status(db, services, _get(db, item_id), KnowledgeStatus.APPROVED, user)


@router.post("/{item_id}/archive", response_model=KnowledgeItemOut)
def archive_item(
    item_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    return _set_status(db, services, _get(db, item_id), KnowledgeStatus.ARCHIVED, user)


@router.post("/{item_id}/unapprove", response_model=KnowledgeItemOut)
def unapprove_item(
    item_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    return _set_status(db, services, _get(db, item_id), KnowledgeStatus.DRAFT, user)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    item = _get(db, item_id)
    was_approved = item.status == KnowledgeStatus.APPROVED
    db.delete(item)
    db.commit()
    if was_approved:
        services.cag.bump_version(db, f"Item {item_id} deleted", user.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/versions")
def list_versions(_: User = Depends(require_staff), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.scalars(select(KnowledgeBaseVersion).order_by(KnowledgeBaseVersion.version.desc()).limit(50))
    return [
        {"version": r.version, "reason": r.reason, "changed_by": r.changed_by, "created_at": r.created_at}
        for r in rows
    ]


@router.get("/cag/status", response_model=CagStatus)
def cag_status(
    _: User = Depends(require_staff), db: Session = Depends(get_db), services: Services = Depends(get_services)
):
    status_info = services.cag.status(db)
    return CagStatus(
        kb_version=status_info["kb_version"],
        audiences=status_info["audiences"],
        max_context_tokens=status_info["effective_budget"],
        model_num_ctx=services.settings.ollama_num_ctx,
        reuse_explanation=KV_CACHE_EXPLANATION,
    )


@router.post("/cag/rebuild", response_model=CagStatus)
def cag_rebuild(
    _: User = Depends(require_admin), db: Session = Depends(get_db), services: Services = Depends(get_services)
):
    services.cag.rebuild(db)
    return cag_status(_, db, services)


@router.get("/cag/preview")
def cag_preview(
    audience: Literal["public", "staff"] = "public",
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
) -> dict:
    lookup = services.cag.get_context(db, audience)
    ctx = lookup.context
    return {
        "audience": audience,
        "kb_version": ctx.kb_version,
        "token_estimate": ctx.token_estimate,
        "content_hash": ctx.content_hash,
        "excluded_item_ids": ctx.excluded_item_ids,
        "outdated_item_ids": ctx.outdated_item_ids,
        "reused": lookup.reused,
        "source": lookup.source,
        "text": ctx.text,
    }
