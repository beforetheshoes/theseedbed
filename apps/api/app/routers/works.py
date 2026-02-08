from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.works import get_work_detail, list_work_editions

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


@router.get("/api/v1/works/{work_id}/editions")
def list_editions(
    work_id: uuid.UUID,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict[str, object]:
    try:
        items = list_work_editions(session, work_id=work_id, limit=limit)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"items": items})
