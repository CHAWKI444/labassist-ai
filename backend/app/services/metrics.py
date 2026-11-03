import logging
from datetime import timedelta

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import RequestMetric
from app.models.base import utcnow

logger = logging.getLogger(__name__)


def purge_expired_metrics(db: Session, retention_days: int) -> int:
    result = db.execute(delete(RequestMetric).where(RequestMetric.created_at < utcnow() - timedelta(days=retention_days)))
    db.commit()
    if result.rowcount:
        logger.info("Purged %s request metrics older than %s days", result.rowcount, retention_days)
    return result.rowcount or 0
