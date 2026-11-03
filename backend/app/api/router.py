from fastapi import APIRouter

from app.api import (
    account,
    admin,
    auth,
    chat,
    conversations,
    dashboard,
    documents,
    health,
    invitations,
    knowledge,
    labvision,
    memories,
    notifications,
    users,
)

api_router = APIRouter(prefix="/api")
for module in (
    health, auth, account, chat, conversations, documents, knowledge, memories, notifications, invitations, users,
    dashboard, admin, labvision,
):
    api_router.include_router(module.router)
