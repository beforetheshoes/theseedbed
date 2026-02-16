from __future__ import annotations

import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.models.bibliography import Author
from app.db.session import get_db_session
from app.routers.books import get_open_library_client
from app.services.open_library import OpenLibraryClient
from app.services.works import get_openlibrary_author_profile

router = APIRouter(tags=["authors"])


@router.get("/api/v1/authors/{author_id}")
async def get_author(
    author_id: uuid.UUID,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
) -> dict[str, object]:
    try:
        profile = await get_openlibrary_author_profile(
            session,
            author_id=author_id,
            open_library=open_library,
        )
    except LookupError:
        # Discovery UI can reference legacy/stale author ids; return a safe empty
        # profile so the client can render without noisy 404 requests.
        author = session.get(Author, author_id)
        return ok(
            {
                "id": str(author_id),
                "name": author.name if author else "Unknown author",
                "bio": None,
                "photo_url": None,
                "openlibrary_author_key": None,
                "works": [],
            }
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    return ok(profile)
