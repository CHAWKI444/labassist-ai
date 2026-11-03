"""labvision: dataset analyses and reviewable findings

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-25 03:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0005'
down_revision: Union[str, None] = '0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'labvision_analyses',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('dataset_name', sa.String(length=255), nullable=False),
        sa.Column('file_type', sa.String(length=10), nullable=False),
        sa.Column('sheet_name', sa.String(length=120), nullable=True),
        sa.Column('size_bytes', sa.Integer(), nullable=False),
        sa.Column('sha256', sa.String(length=64), nullable=False),
        sa.Column('row_count', sa.Integer(), nullable=False),
        sa.Column('column_count', sa.Integer(), nullable=False),
        sa.Column('quality_score', sa.Float(), nullable=True),
        sa.Column('finding_count', sa.Integer(), nullable=False),
        sa.Column('config', sa.JSON(), nullable=False),
        sa.Column('results', sa.JSON(), nullable=False),
        sa.Column('explanation', sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('labvision_analyses', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_labvision_analyses_user_id'), ['user_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_labvision_analyses_expires_at'), ['expires_at'], unique=False)
        batch_op.create_index('ix_labvision_analyses_user_created', ['user_id', 'created_at'], unique=False)

    op.create_table(
        'labvision_findings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('analysis_id', sa.Integer(), nullable=False),
        sa.Column('category', sa.String(length=30), nullable=False),
        sa.Column('issue_type', sa.String(length=40), nullable=False),
        sa.Column('method', sa.String(length=40), nullable=False),
        sa.Column('severity', sa.String(length=10), nullable=False),
        sa.Column('column', sa.String(length=255), nullable=True),
        sa.Column('row_numbers', sa.JSON(), nullable=False),
        sa.Column('affected_count', sa.Integer(), nullable=False),
        sa.Column('record_id', sa.String(length=255), nullable=True),
        sa.Column('observed_value', sa.String(length=500), nullable=True),
        sa.Column('score', sa.Float(), nullable=True),
        sa.Column('threshold', sa.String(length=255), nullable=True),
        sa.Column('explanation', sa.Text(), nullable=False),
        sa.Column('suggested_action', sa.Text(), nullable=False),
        sa.Column('review_status', sa.String(length=20), nullable=False),
        sa.Column('review_note', sa.String(length=500), nullable=True),
        sa.Column('reviewed_by', sa.Integer(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['analysis_id'], ['labvision_analyses.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['reviewed_by'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    with op.batch_alter_table('labvision_findings', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_labvision_findings_analysis_id'), ['analysis_id'], unique=False)
        batch_op.create_index('ix_labvision_findings_analysis_review', ['analysis_id', 'review_status'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('labvision_findings', schema=None) as batch_op:
        batch_op.drop_index('ix_labvision_findings_analysis_review')
        batch_op.drop_index(batch_op.f('ix_labvision_findings_analysis_id'))
    op.drop_table('labvision_findings')

    with op.batch_alter_table('labvision_analyses', schema=None) as batch_op:
        batch_op.drop_index('ix_labvision_analyses_user_created')
        batch_op.drop_index(batch_op.f('ix_labvision_analyses_expires_at'))
        batch_op.drop_index(batch_op.f('ix_labvision_analyses_user_id'))
    op.drop_table('labvision_analyses')
