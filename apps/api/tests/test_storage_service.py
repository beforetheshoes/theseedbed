from __future__ import annotations

import asyncio

import httpx

from app.core.config import Settings
from app.services.storage import upload_storage_object


def _settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )


def test_upload_storage_object_puts_bytes_and_returns_public_url() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        assert request.url.path == "/storage/v1/object/covers/a/b.txt"
        assert request.headers["authorization"] == "Bearer service-role"
        assert request.headers["x-upsert"] == "true"
        assert request.headers["content-type"] == "text/plain"
        return httpx.Response(200, json={"Key": "ok"})

    transport = httpx.MockTransport(handler)

    async def run() -> str:
        result = await upload_storage_object(
            settings=_settings(),
            bucket="covers",
            path="a/b.txt",
            content=b"hello",
            content_type="text/plain",
            transport=transport,
        )
        return result.public_url

    url = asyncio.run(run())
    assert url == "https://example.supabase.co/storage/v1/object/public/covers/a/b.txt"


def test_upload_storage_object_requires_url_and_service_key() -> None:
    bad = Settings(
        supabase_url="",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )

    async def run_missing_url() -> None:
        await upload_storage_object(
            settings=bad,
            bucket="covers",
            path="x",
            content=b"x",
            content_type="text/plain",
        )

    try:
        asyncio.run(run_missing_url())
    except RuntimeError:
        pass
    else:
        raise AssertionError("expected RuntimeError")

    bad = Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key=None,
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )

    async def run_missing_key() -> None:
        await upload_storage_object(
            settings=bad,
            bucket="covers",
            path="x",
            content=b"x",
            content_type="text/plain",
        )

    try:
        asyncio.run(run_missing_key())
    except RuntimeError:
        pass
    else:
        raise AssertionError("expected RuntimeError")
