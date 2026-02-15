from __future__ import annotations

from typing import cast

import sqlalchemy as sa

from app.db.models.imports import StorygraphImportJob, StorygraphImportJobRow


def test_storygraph_import_job_model_shape() -> None:
    table = StorygraphImportJob.__table__
    assert set(table.columns.keys()) == {
        "id",
        "user_id",
        "filename",
        "status",
        "total_rows",
        "processed_rows",
        "imported_rows",
        "failed_rows",
        "skipped_rows",
        "error_summary",
        "started_at",
        "finished_at",
        "created_at",
        "updated_at",
    }
    status_type = cast(sa.Enum, table.columns["status"].type)
    assert status_type.name == "storygraph_import_job_status"


def test_storygraph_import_row_model_shape() -> None:
    table = StorygraphImportJobRow.__table__
    assert set(table.columns.keys()) == {
        "id",
        "job_id",
        "user_id",
        "row_number",
        "identity_hash",
        "title",
        "uid",
        "result",
        "message",
        "work_id",
        "library_item_id",
        "review_id",
        "session_id",
        "created_at",
    }
    result_type = cast(sa.Enum, table.columns["result"].type)
    assert result_type.name == "storygraph_import_row_result"
