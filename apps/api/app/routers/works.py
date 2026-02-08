from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.db.session import get_db_session
from app.services.works import get_work_detail

router = APIRouter(tags=["works"])


@router.get("/api/v1/works/{work_id}")
def get_work(
    work_id: uuid.UUID,
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        detail = get_work_detail(session, work_id=work_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok(detail)
