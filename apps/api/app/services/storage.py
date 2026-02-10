from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import quote

import httpx

from app.core.config import Settings


@dataclass(frozen=True)
class StorageUploadResult:
    public_url: str
    bucket: str
    path: str


class StorageNotConfiguredError(RuntimeError):
    """Raised when required Supabase storage settings are missing."""


def _public_object_url(*, supabase_url: str, bucket: str, path: str) -> str:
    # Public bucket/object access URL pattern.
    # Note: access depends on bucket/public policy in Supabase.
    safe_bucket = quote(bucket, safe="")
    safe_path = quote(path, safe="/._-")
    return f"{supabase_url}/storage/v1/object/public/{safe_bucket}/{safe_path}"


async def upload_storage_object(
    *,
    settings: Settings,
    bucket: str,
    path: str,
    content: bytes,
    content_type: str,
    upsert: bool = True,
    transport: httpx.AsyncBaseTransport | None = None,
) -> StorageUploadResult:
    if not settings.supabase_url:
        raise StorageNotConfiguredError("SUPABASE_URL is not configured")
    if not settings.supabase_service_role_key:
        raise StorageNotConfiguredError("SUPABASE_SERVICE_ROLE_KEY is not configured")

    safe_bucket = quote(bucket, safe="")
    safe_path = quote(path, safe="/._-")
    url = f"{settings.supabase_url}/storage/v1/object/{safe_bucket}/{safe_path}"
    headers = {
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        # Supabase storage expects apikey even when using Authorization.
        "apikey": settings.supabase_service_role_key,
        "Content-Type": content_type,
        "x-upsert": "true" if upsert else "false",
    }

    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        response = await client.put(url, content=content, headers=headers)
    response.raise_for_status()

    return StorageUploadResult(
        public_url=_public_object_url(
            supabase_url=settings.supabase_url,
            bucket=bucket,
            path=path,
        ),
        bucket=bucket,
        path=path,
    )
