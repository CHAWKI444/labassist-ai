"""metrics: stage timings, quality and safety signals, answer feedback

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-25 02:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0004'
down_revision: Union[str, None] = '0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_METRIC_COLUMNS = [
    ('first_token_ms', sa.Integer()),
    ('retrieval_ms', sa.Integer()),
    ('cag_ms', sa.Integer()),
    ('generation_ms', sa.Integer()),
    ('eval_ms', sa.Integer()),
    ('rag_top_score', sa.Float()),
    ('rag_passages', sa.Integer()),
    ('no_source', sa.Boolean()),
    ('cag_reused', sa.Boolean()),
    ('diagnosis_guard', sa.Boolean()),
    ('memory_refused_sensitive', sa.Boolean()),
]


def upgrade() -> None:
    with op.batch_alter_table('request_metrics', schema=None) as batch_op:
        for name, type_ in _METRIC_COLUMNS:
            batch_op.add_column(sa.Column(name, type_, nullable=True))
        batch_op.create_index('ix_request_metrics_kind_created_at', ['kind', 'created_at'], unique=False)

    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.add_column(sa.Column('feedback', sa.SmallInteger(), nullable=True))
        batch_op.add_column(sa.Column('feedback_at', sa.DateTime(timezone=True), nullable=True))
        batch_op.create_index(batch_op.f('ix_messages_feedback_at'), ['feedback_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_messages_feedback_at'))
        batch_op.drop_column('feedback_at')
        batch_op.drop_column('feedback')

    with op.batch_alter_table('request_metrics', schema=None) as batch_op:
        batch_op.drop_index('ix_request_metrics_kind_created_at')
        for name, _ in reversed(_METRIC_COLUMNS):
            batch_op.drop_column(name)
