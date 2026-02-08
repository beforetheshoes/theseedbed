from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.manual_covers import (
    ImageValidationError,
    cache_edition_cover_from_source_url,
    set_edition_cover_from_upload,
)

router = APIRouter(
    prefix="/api/v1/editions",
    tags=["editions"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


class CacheCoverRequest(BaseModel):
    source_url: str = Field(min_length=8, max_length=2048)


@router.post("/{edition_id}/cover")
async def upload_cover(
    edition_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: Annotated[UploadFile, File()],
) -> dict[str, object]:
    content = await file.read()
    try:
        result = await set_edition_cover_from_upload(
            session,
            settings=settings,
            user_id=auth.user_id,
            edition_id=edition_id,
            content=content,
            content_type=file.content_type,
        )
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return ok(result)


@router.post("/{edition_id}/cover/cache")
async def cache_cover(
    edition_id: uuid.UUID,
    payload: CacheCoverRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        result = await cache_edition_cover_from_source_url(
            session,
            settings=settings,
            user_id=auth.user_id,
            edition_id=edition_id,
            source_url=payload.source_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return ok(result)
