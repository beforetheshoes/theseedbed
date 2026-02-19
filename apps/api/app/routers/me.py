from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.user_library import (
    DEFAULT_SOURCE_LANGUAGE,
    get_or_create_profile,
    update_profile,
)


class UpdateProfileRequest(BaseModel):
    handle: str | None = Field(default=None, max_length=64)
    display_name: str | None = Field(default=None, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=2048)
    enable_google_books: bool | None = None
    theme_primary_color: str | None = Field(default=None, max_length=7)
    theme_accent_color: str | None = Field(default=None, max_length=7)
    theme_font_family: str | None = Field(default=None, max_length=32)
    theme_heading_font_family: str | None = Field(default=None, max_length=32)
    default_progress_unit: (
        Literal["pages_read", "percent_complete", "minutes_listened"] | None
    ) = None
    default_source_language: str | None = Field(
        default=None, min_length=2, max_length=3
    )


router = APIRouter(
    prefix="/api/v1/me",
    tags=["me"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


@router.get("")
def get_me(
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    profile = get_or_create_profile(session, user_id=auth.user_id)
    default_source_language = (
        profile.default_source_language.strip().lower()
        if isinstance(profile.default_source_language, str)
        and profile.default_source_language.strip()
        else DEFAULT_SOURCE_LANGUAGE
    )
    default_source_language = (
        profile.default_source_language.strip().lower()
        if isinstance(profile.default_source_language, str)
        and profile.default_source_language.strip()
        else DEFAULT_SOURCE_LANGUAGE
    )

    return ok(
        {
            "id": str(profile.id),
            "handle": profile.handle,
            "display_name": profile.display_name,
            "avatar_url": profile.avatar_url,
            "enable_google_books": profile.enable_google_books,
            "theme_primary_color": profile.theme_primary_color,
            "theme_accent_color": profile.theme_accent_color,
            "theme_font_family": profile.theme_font_family,
            "theme_heading_font_family": profile.theme_heading_font_family,
            "default_progress_unit": profile.default_progress_unit,
            "default_source_language": default_source_language,
        }
    )


@router.patch("")
def patch_me(
    payload: UpdateProfileRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        profile = update_profile(
            session,
            user_id=auth.user_id,
            handle=payload.handle,
            display_name=payload.display_name,
            avatar_url=payload.avatar_url,
            enable_google_books=payload.enable_google_books,
            theme_primary_color=payload.theme_primary_color,
            theme_accent_color=payload.theme_accent_color,
            theme_font_family=payload.theme_font_family,
            theme_heading_font_family=payload.theme_heading_font_family,
            default_progress_unit=payload.default_progress_unit,
            default_source_language=payload.default_source_language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    default_source_language = (
        profile.default_source_language.strip().lower()
        if isinstance(profile.default_source_language, str)
        and profile.default_source_language.strip()
        else DEFAULT_SOURCE_LANGUAGE
    )

    return ok(
        {
            "id": str(profile.id),
            "handle": profile.handle,
            "display_name": profile.display_name,
            "avatar_url": profile.avatar_url,
            "enable_google_books": profile.enable_google_books,
            "theme_primary_color": profile.theme_primary_color,
            "theme_accent_color": profile.theme_accent_color,
            "theme_font_family": profile.theme_font_family,
            "theme_heading_font_family": profile.theme_heading_font_family,
            "default_progress_unit": profile.default_progress_unit,
            "default_source_language": default_source_language,
        }
    )
