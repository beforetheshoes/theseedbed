from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.reviews import (
    delete_review,
    list_public_reviews_for_work,
    list_reviews_for_user,
    upsert_review_for_work,
)

ReviewVisibility = Literal["private", "unlisted", "public"]


class UpsertReviewRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    body: str = Field(min_length=1)
    rating: int | None = Field(default=None, ge=1, le=5)
    visibility: ReviewVisibility = "private"
    edition_id: uuid.UUID | None = None


public_router = APIRouter(tags=["reviews"])


@public_router.get("/api/v1/works/{work_id}/reviews")
def list_work_reviews(
    work_id: uuid.UUID,
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> dict[str, object]:
    items = list_public_reviews_for_work(session, work_id=work_id, limit=limit)
    return ok({"items": items})


router = APIRouter(
    tags=["reviews"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


@router.get("/api/v1/me/reviews")
def list_my_reviews(
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> dict[str, object]:
    items = list_reviews_for_user(session, user_id=auth.user_id, limit=limit)
    return ok({"items": items})


@router.post("/api/v1/works/{work_id}/review")
def upsert_work_review(
    work_id: uuid.UUID,
    payload: UpsertReviewRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        review = upsert_review_for_work(
            session,
            user_id=auth.user_id,
            work_id=work_id,
            title=payload.title,
            body=payload.body,
            rating=payload.rating,
            visibility=payload.visibility,
            edition_id=payload.edition_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(review.id)})


@router.delete("/api/v1/reviews/{review_id}")
def delete_my_review(
    review_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        delete_review(session, user_id=auth.user_id, review_id=review_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"deleted": True})
