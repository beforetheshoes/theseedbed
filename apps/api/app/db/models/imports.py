from __future__ import annotations

import datetime as dt
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

storygraph_import_job_status_enum = ENUM(
    "queued",
    "running",
    "completed",
    "failed",
    name="storygraph_import_job_status",
    create_type=False,
)

storygraph_import_row_result_enum = ENUM(
    "imported",
    "failed",
    "skipped",
    name="storygraph_import_row_result",
    create_type=False,
)


class StorygraphImportJob(Base):
    __tablename__ = "storygraph_import_jobs"
    __table_args__ = (
        sa.Index(
            "ix_storygraph_import_jobs_user_created",
            "user_id",
            "created_at",
        ),
        sa.Index("ix_storygraph_import_jobs_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    filename: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    status: Mapped[str] = mapped_column(
        storygraph_import_job_status_enum, nullable=False
    )
    total_rows: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default="0"
    )
    processed_rows: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default="0"
    )
    imported_rows: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default="0"
    )
    failed_rows: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default="0"
    )
    skipped_rows: Mapped[int] = mapped_column(
        sa.Integer, nullable=False, server_default="0"
    )
    error_summary: Mapped[str | None] = mapped_column(sa.Text)
    started_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    finished_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class StorygraphImportJobRow(Base):
    __tablename__ = "storygraph_import_job_rows"
    __table_args__ = (
        sa.Index("ix_storygraph_import_job_rows_job_row", "job_id", "row_number"),
        sa.Index("ix_storygraph_import_job_rows_job_result", "job_id", "result"),
        sa.UniqueConstraint(
            "job_id",
            "identity_hash",
            name="uq_storygraph_import_job_rows_job_identity",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    job_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("storygraph_import_jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    row_number: Mapped[int] = mapped_column(sa.Integer, nullable=False)
    identity_hash: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    title: Mapped[str | None] = mapped_column(sa.String(512))
    uid: Mapped[str | None] = mapped_column(sa.String(255))
    result: Mapped[str] = mapped_column(
        storygraph_import_row_result_enum, nullable=False
    )
    message: Mapped[str] = mapped_column(sa.Text, nullable=False)
    work_id: Mapped[uuid.UUID | None] = mapped_column(sa.UUID(as_uuid=True))
    library_item_id: Mapped[uuid.UUID | None] = mapped_column(sa.UUID(as_uuid=True))
    review_id: Mapped[uuid.UUID | None] = mapped_column(sa.UUID(as_uuid=True))
    session_id: Mapped[uuid.UUID | None] = mapped_column(sa.UUID(as_uuid=True))
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
