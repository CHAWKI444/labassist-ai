from dataclasses import dataclass

from sqlalchemy.orm import sessionmaker

from app.core.config import Settings
from app.services.cag.service import CagService
from app.services.email import EmailSender, build_email_sender
from app.services.embeddings import Embedder, build_embedder
from app.services.invitations import InvitationService
from app.services.labvision.service import LabVisionService
from app.services.llm import LLMClient, OllamaClient
from app.services.mag.service import MagService
from app.services.orchestration.orchestrator import Orchestrator
from app.services.rag.service import RagService
from app.services.rag.vector_store import FaissStore


@dataclass
class Services:
    settings: Settings
    sessions: sessionmaker
    embedder: Embedder
    store: FaissStore
    llm: LLMClient
    rag: RagService
    cag: CagService
    mag: MagService
    orchestrator: Orchestrator
    email: EmailSender
    invitations: InvitationService
    labvision: LabVisionService


def build_services(
    settings: Settings,
    sessions: sessionmaker,
    embedder: Embedder | None = None,
    llm: LLMClient | None = None,
    email: EmailSender | None = None,
    persist_index: bool = True,
) -> Services:
    embedder = embedder or build_embedder(settings)
    llm = llm or OllamaClient(settings)
    email = email or build_email_sender(settings)
    store = FaissStore(settings.index_dir if persist_index else None, embedder.name)
    store.load()
    rag = RagService(settings, sessions, embedder, store)
    cag = CagService(settings)
    mag = MagService(settings)
    orchestrator = Orchestrator(settings, rag, cag, mag, llm)
    invitations = InvitationService(settings, email)
    labvision = LabVisionService(settings, llm)
    return Services(settings, sessions, embedder, store, llm, rag, cag, mag, orchestrator, email, invitations, labvision)
