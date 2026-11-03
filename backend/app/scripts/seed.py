"""Bootstrap an admin account and optional fictitious demo data.

Usage (from backend/):
    python -m app.scripts.seed                 # admin only (ADMIN_EMAIL / ADMIN_PASSWORD)
    python -m app.scripts.seed --demo          # + demo staff/patient users and approved knowledge
    python -m app.scripts.seed --sample-docs   # + index docs/sample-documents (needs Ollama + bge-m3)
"""

import argparse
import hashlib
import sys
from datetime import date, timedelta

from sqlalchemy import select

from app.core.config import REPO_DIR, get_settings
from app.core.database import session_factory
from app.core.security import hash_password
from app.models import Document, KnowledgeItem, Role, User
from app.models.base import utcnow
from app.models.document import DocumentStatus
from app.models.knowledge import KnowledgeStatus
from app.services.container import build_services

DEMO_NOTE = "Fictitious demo data - not real laboratory information."

DEMO_KNOWLEDGE = [
    dict(kind="faq", language="fr", visibility="public", priority=10, title="Horaires d'ouverture",
         content="Le Laboratoire de démonstration LabAssist (fictif) est ouvert du lundi au vendredi de 7h00 à "
                 "18h00 et le samedi de 7h30 à 12h30. Il est fermé le dimanche et les jours fériés. "
                 "Les prélèvements sanguins se font sans rendez-vous jusqu'à 11h00."),
    dict(kind="procedure", language="fr", visibility="public", priority=20, title="Jeûne avant une prise de sang",
         content="Pour la glycémie à jeun et le bilan lipidique, un jeûne de 10 à 12 heures est demandé. L'eau plate "
                 "est autorisée. Pour la plupart des autres analyses, le jeûne n'est pas nécessaire, sauf mention "
                 "contraire sur l'ordonnance. En cas de doute, contactez le laboratoire."),
    dict(kind="faq", language="fr", visibility="public", priority=30, title="Documents à apporter",
         content="Merci d'apporter l'ordonnance originale, une pièce d'identité et votre carte d'assurance maladie. "
                 "Pour un mineur, la présence d'un parent ou tuteur légal est requise."),
    dict(kind="policy", language="fr", visibility="public", priority=40, title="Délais et remise des résultats",
         content="La plupart des analyses de biochimie courante sont disponibles le jour même après 17h00. Certaines "
                 "analyses spécialisées peuvent prendre jusqu'à 7 jours ouvrés. Les résultats sont disponibles sur le "
                 "portail patient ou à l'accueil sur présentation d'une pièce d'identité. Ils ne sont jamais "
                 "communiqués par téléphone."),
    dict(kind="policy", language="fr", visibility="public", priority=50, title="Interprétation des résultats",
         content="Le personnel du laboratoire ne fournit pas d'interprétation diagnostique. Les résultats doivent être "
                 "interprétés par le médecin prescripteur, qui reçoit une copie."),
    dict(kind="procedure", language="en", visibility="public", priority=60, title="Urine sample collection",
         content="Collect the first morning urine in the sterile container provided by the laboratory, after washing "
                 "hands and cleaning the area. Discard the first stream and collect the midstream. Bring the sample "
                 "to the laboratory within 2 hours, or keep it refrigerated for up to 12 hours."),
    dict(kind="faq", language="ar", visibility="public", priority=70, title="ساعات العمل",
         content="المختبر التجريبي LabAssist (وهمي) مفتوح من الاثنين إلى الجمعة من الساعة 7:00 إلى 18:00، ويوم السبت "
                 "من 7:30 إلى 12:30. مغلق يوم الأحد وأيام العطل الرسمية."),
    dict(kind="faq", language="fr", visibility="public", priority=80, title="Tarifs des analyses courantes",
         content="Bilan lipidique : 25 EUR. Glycémie à jeun : 8 EUR. Numération formule sanguine : 12 EUR. "
                 "Les tarifs sont donnés à titre indicatif et peuvent être pris en charge par l'assurance maladie.",
         review_due=date.today() - timedelta(days=30)),
    dict(kind="procedure", language="fr", visibility="staff", priority=90, title="Centrifugation et stockage des tubes",
         content="Les tubes secs et héparinés sont centrifugés 10 minutes à 3000 g dans les 2 heures suivant le "
                 "prélèvement. Le sérum est conservé entre 2 et 8 °C pendant 48 heures maximum. Toute non-conformité "
                 "est enregistrée dans le registre qualité."),
    dict(kind="procedure", language="fr", visibility="staff", priority=100, title="Accident d'exposition au sang",
         content="En cas de piqûre ou de projection : nettoyer immédiatement à l'eau et au savon, rincer, désinfecter "
                 "5 minutes, prévenir le responsable de poste et suivre la procédure AES interne (fictive) référence "
                 "DEMO-AES-01. Déclarer l'accident dans les 24 heures."),
]


def ensure_user(db, email: str, name: str, password: str, role: Role, memory_enabled: bool = False) -> User:
    user = db.scalar(select(User).where(User.email == email))
    if user:
        print(f"  user exists: {email} ({user.role})")
        return user
    user = User(email=email, full_name=name, hashed_password=hash_password(password), role=role.value,
                memory_enabled=memory_enabled)
    db.add(user)
    db.commit()
    print(f"  created {role.value}: {email}")
    return user


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true", help="create demo users and approved knowledge")
    parser.add_argument("--sample-docs", action="store_true", help="index docs/sample-documents")
    args = parser.parse_args()

    settings = get_settings()
    admin_email = settings.admin_email.strip().lower()
    admin_password = settings.admin_password
    if not admin_email or len(admin_password) < 8:
        print("Set ADMIN_EMAIL and ADMIN_PASSWORD (>= 8 chars) in .env or the environment.", file=sys.stderr)
        return 1

    services = build_services(settings, session_factory())
    with services.sessions() as db:
        print("Users:")
        admin = ensure_user(db, admin_email, "Administrator", admin_password, Role.ADMIN)

        if args.demo:
            demo_password = settings.demo_user_password
            if len(demo_password) < 8:
                print("Set DEMO_USER_PASSWORD (>= 8 chars) to create demo users.", file=sys.stderr)
                return 1
            ensure_user(db, "staff@labassist.local", "Demo Staff (fictitious)", demo_password, Role.STAFF, True)
            ensure_user(db, "patient@labassist.local", "Demo Patient (fictitious)", demo_password, Role.PATIENT, True)

            print("Approved knowledge (CAG):")
            created = 0
            for entry in DEMO_KNOWLEDGE:
                if db.scalar(select(KnowledgeItem).where(KnowledgeItem.title == entry["title"])):
                    continue
                db.add(KnowledgeItem(**entry, status=KnowledgeStatus.APPROVED, created_by=admin.id,
                                     approved_by=admin.id, approved_at=utcnow()))
                created += 1
            db.commit()
            if created:
                version = services.cag.bump_version(db, f"Seeded {created} demo items ({DEMO_NOTE})", admin.id)
                print(f"  {created} items approved, knowledge-base version {version}")
            else:
                print("  demo items already present")

        if args.sample_docs:
            print("Sample documents (RAG):")
            sample_dir = REPO_DIR / "docs" / "sample-documents"
            for path in sorted(sample_dir.glob("*.txt")):
                content = path.read_bytes()
                digest = hashlib.sha256(content).hexdigest()
                existing = db.scalar(select(Document).where(Document.sha256 == digest))
                if existing and existing.status == DocumentStatus.INDEXED:
                    print(f"  already indexed: {path.name}")
                    continue
                if existing:
                    services.rag.ingest(existing.id)
                    db.refresh(existing)
                    print(f"  {path.name}: re-indexed, {existing.status} ({existing.num_chunks} chunks) "
                          f"{existing.error or ''}")
                    continue
                visibility = "staff" if path.name.startswith("staff-") else "public"
                stored, _ = services.rag.store_file(content, "txt")
                document = Document(title=path.stem.replace("-", " ").title(), original_filename=path.name,
                                    stored_filename=stored, file_type="txt", size_bytes=len(content), sha256=digest,
                                    visibility=visibility, status=DocumentStatus.PROCESSING, uploaded_by=admin.id)
                db.add(document)
                db.commit()
                services.rag.ingest(document.id)
                db.refresh(document)
                print(f"  {path.name}: {document.status} ({document.num_chunks} chunks) {document.error or ''}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
