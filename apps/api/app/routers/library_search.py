from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.user_library import search_library_items

router = APIRouter(
    prefix="/api/v1/library",
    tags=["library"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


@router.get("/search")
def search(
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    query: Annotated[str, Query(min_length=2, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
) -> dict[str, object]:
    items = search_library_items(
        session,
        user_id=auth.user_id,
        query=query,
        limit=limit,
    )
    return ok({"items": items})
