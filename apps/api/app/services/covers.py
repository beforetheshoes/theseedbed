from __future__ import annotations

import datetime as dt
import hashlib
import ipaddress
import socket
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

import anyio
import httpx
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.bibliography import Edition, Work
from app.services.images import ImageValidationError, normalize_cover_image
from app.services.storage import StorageUploadResult, upload_storage_object


@dataclass(frozen=True)
class CoverCacheResult:
    cached: bool
    cover_url: str | None
    storage: StorageUploadResult | None = None


_MAX_CACHED_COVER_BYTES = 10 * 1024 * 1024
_MAX_CACHED_COVER_DIMENSION = 4000


def _is_supabase_storage_url(*, settings: Settings, url: str) -> bool:
    if not settings.supabase_url:
        return False
    return url.startswith(f"{settings.supabase_url.rstrip('/')}/storage/v1/")


def _guess_extension(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if path.endswith(ext):
            return ext
    return ".jpg"


def _parse_public_storage_object_url(
    *, settings: Settings, url: str
) -> StorageUploadResult | None:
    if not settings.supabase_url:
        return None
    base = settings.supabase_url.rstrip("/")
    if not url.startswith(f"{base}/storage/v1/object/public/"):
        return None
    path = url[len(f"{base}/storage/v1/object/public/") :]
    # Path format: {bucket}/{object_path}
    bucket, sep, object_path = path.partition("/")
    if not sep or not bucket or not object_path:
        return None
    return StorageUploadResult(public_url=url, bucket=bucket, path=object_path)


def _is_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    # ip.is_global is the closest thing to "public routable" in stdlib.
    return bool(getattr(ip, "is_global", False))


def _is_blocked_hostname(host: str) -> bool:
    host = host.lower().strip(".")
    if not host:
        return True
    if host in {"localhost", "localhost.localdomain"}:
        return True
    if host.endswith(".local"):
        return True
    return False


def _resolve_host_ips(host: str) -> set[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    ips: set[ipaddress.IPv4Address | ipaddress.IPv6Address] = set()
    for family, _type, _proto, _canonname, sockaddr in socket.getaddrinfo(host, None):
        if family == socket.AF_INET:
            ip_str = sockaddr[0]
        elif family == socket.AF_INET6:
            ip_str = sockaddr[0]
        else:
            continue
        try:
            ips.add(ipaddress.ip_address(ip_str))
        except ValueError:
            continue
    return ips


async def _require_safe_public_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("source_url must be an http(s) URL")

    host = (parsed.hostname or "").strip()
    if _is_blocked_hostname(host):
        raise ValueError("source_url must be a public http(s) URL")

    # Literal IPs: validate directly without DNS.
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None

    if ip is not None:
        if not _is_public_ip(ip):
            raise ValueError("source_url must be a public http(s) URL")
        return

    # DNS resolve in a worker thread, then ensure every resolved address is public.
    ips = await anyio.to_thread.run_sync(_resolve_host_ips, host)
    if not ips:
        raise ValueError("source_url must be a public http(s) URL")
    if any(not _is_public_ip(ip) for ip in ips):
        raise ValueError("source_url must be a public http(s) URL")


async def cache_cover_to_storage(
    *,
    settings: Settings,
    source_url: str,
    transport: httpx.AsyncBaseTransport | None = None,
    storage_transport: httpx.AsyncBaseTransport | None = None,
) -> StorageUploadResult:
    """Cache an external cover image into Supabase storage and return the public URL.

    This does not mutate Work/Edition/LibraryItem rows; callers own DB writes.
    """
    if _is_supabase_storage_url(settings=settings, url=source_url):
        parsed = _parse_public_storage_object_url(settings=settings, url=source_url)
        if parsed is not None:
            return parsed
        # Fallback: it's a Supabase storage URL but doesn't match the public pattern.
        # Still treat it as "already cached".
        return StorageUploadResult(
            public_url=source_url,
            bucket=settings.supabase_storage_covers_bucket,
            path="",
        )

    await _require_safe_public_http_url(source_url)

    async with httpx.AsyncClient(
        timeout=20.0, transport=transport, follow_redirects=True
    ) as client:
        async with client.stream(
            "GET", source_url, headers={"User-Agent": "TheSeedbed/0.1"}
        ) as response:
            response.raise_for_status()

            # Validate redirect chain targets too.
            for hop in [*response.history, response]:
                await _require_safe_public_http_url(str(hop.url))

            declared_len = response.headers.get("Content-Length")
            if declared_len is not None:
                try:
                    declared_int = int(declared_len)
                except ValueError:
                    declared_int = None
                if declared_int is not None and declared_int > _MAX_CACHED_COVER_BYTES:
                    raise ValueError("image is too large")

            raw = bytearray()
            async for chunk in response.aiter_bytes():
                raw += chunk
                if len(raw) > _MAX_CACHED_COVER_BYTES:
                    raise ValueError("image is too large")

            content_type = (
                response.headers.get("Content-Type", "").split(";", 1)[0].strip()
            ) or None

    try:
        normalized, out_content_type = normalize_cover_image(
            content=bytes(raw),
            content_type=content_type,
            max_bytes=_MAX_CACHED_COVER_BYTES,
            max_dimension=_MAX_CACHED_COVER_DIMENSION,
        )
    except ImageValidationError as exc:
        raise ValueError(str(exc)) from exc

    ext = _guess_extension(source_url)
    digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:32]
    path = f"openlibrary/{digest}{ext}"

    return await upload_storage_object(
        settings=settings,
        bucket=settings.supabase_storage_covers_bucket,
        path=path,
        content=normalized,
        content_type=out_content_type,
        upsert=True,
        transport=storage_transport,
    )


async def cache_edition_cover_from_url(
    session: Session,
    *,
    settings: Settings,
    edition_id: uuid.UUID,
    source_url: str | None,
    user_id: uuid.UUID | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    storage_transport: httpx.AsyncBaseTransport | None = None,
) -> CoverCacheResult:
    if not source_url:
        return CoverCacheResult(cached=False, cover_url=None)
    if _is_supabase_storage_url(settings=settings, url=source_url):
        return CoverCacheResult(cached=False, cover_url=source_url)

    # Reject unsafe URLs early, before any DB lookup.
    await _require_safe_public_http_url(source_url)

    edition = session.scalar(sa.select(Edition).where(Edition.id == edition_id))
    if edition is None:
        raise LookupError("edition not found")

    if edition.cover_url and _is_supabase_storage_url(
        settings=settings, url=edition.cover_url
    ):
        return CoverCacheResult(cached=False, cover_url=edition.cover_url)

    upload = await cache_cover_to_storage(
        settings=settings,
        source_url=source_url,
        transport=transport,
        storage_transport=storage_transport,
    )

    edition.cover_url = upload.public_url
    edition.cover_storage_path = upload.path
    edition.cover_set_by = user_id
    edition.cover_set_at = dt.datetime.now(tz=dt.UTC)

    work = session.get(Work, edition.work_id)
    if work is not None:
        work.default_cover_url = upload.public_url
        work.default_cover_storage_path = upload.path
        work.default_cover_set_by = user_id
        work.default_cover_set_at = dt.datetime.now(tz=dt.UTC)
    session.commit()

    return CoverCacheResult(cached=True, cover_url=upload.public_url, storage=upload)
