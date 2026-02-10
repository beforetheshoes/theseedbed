from __future__ import annotations

import asyncio
import io
import socket
import uuid
from typing import Any

import httpx
import pytest
import sqlalchemy as sa
from PIL import Image

from app.core.config import Settings
from app.db.models.bibliography import Edition, Work
from app.services import covers as covers_service
from app.services.covers import cache_cover_to_storage, cache_edition_cover_from_url


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.get_values: list[Any] = []
        self.committed = False

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def get(self, _model: object, _id: object) -> Any:
        if self.get_values:
            return self.get_values.pop(0)
        return None

    def commit(self) -> None:
        self.committed = True


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


def _jpeg_bytes() -> bytes:
    img = Image.new("RGB", (20, 30), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_cache_cover_noops_when_already_supabase_url() -> None:
    session = FakeSession()
    edition_id = uuid.uuid4()
    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=edition_id,
            source_url="https://example.supabase.co/storage/v1/object/public/covers/x.jpg",
        )
    )
    assert result.cached is False
    assert result.cover_url is not None
    assert session.committed is False


def test_cache_cover_to_storage_parses_public_object_url() -> None:
    upload = asyncio.run(
        cache_cover_to_storage(
            settings=_settings(),
            source_url="https://example.supabase.co/storage/v1/object/public/covers/x.jpg",
        )
    )
    assert upload.bucket == "covers"
    assert upload.path == "x.jpg"
    assert upload.public_url.endswith("/covers/x.jpg")


def test_cache_cover_to_storage_handles_unknown_supabase_storage_url() -> None:
    upload = asyncio.run(
        cache_cover_to_storage(
            settings=_settings(),
            source_url="https://example.supabase.co/storage/v1/signed/covers/x.jpg",
        )
    )
    assert upload.public_url.endswith("/storage/v1/signed/covers/x.jpg")
    assert upload.bucket == "covers"
    assert upload.path == ""


def test_cache_cover_downloads_uploads_and_updates_edition() -> None:
    edition_id = uuid.uuid4()
    edition = Edition(
        id=edition_id,
        work_id=uuid.uuid4(),
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    work = Work(
        id=edition.work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session = FakeSession()
    session.scalar_values = [edition]
    session.get_values = [work]

    def download_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(
            200,
            headers={"Content-Type": "image/jpeg"},
            content=_jpeg_bytes(),
        )

    def upload_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        assert request.headers["authorization"] == "Bearer service-role"
        assert request.headers["apikey"] == "service-role"
        return httpx.Response(200, json={"Key": "ok"})

    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=edition_id,
            source_url="https://covers.openlibrary.org/b/id/1-L.jpg",
            transport=httpx.MockTransport(download_handler),
            storage_transport=httpx.MockTransport(upload_handler),
        )
    )

    assert result.cached is True
    assert edition.cover_url is not None
    assert edition.cover_url.startswith(
        "https://example.supabase.co/storage/v1/object/public/covers/openlibrary/"
    )
    assert work.default_cover_url == edition.cover_url
    assert session.committed is True


def test_cache_cover_raises_when_edition_missing() -> None:
    session = FakeSession()
    session.scalar_values = [None]
    try:
        asyncio.run(
            cache_edition_cover_from_url(
                session,  # type: ignore[arg-type]
                settings=_settings(),
                edition_id=uuid.uuid4(),
                source_url="https://covers.openlibrary.org/b/id/1-L.png",
            )
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")


def test_cache_cover_noops_when_edition_cover_already_cached() -> None:
    edition_id = uuid.uuid4()
    edition = Edition(
        id=edition_id,
        work_id=uuid.uuid4(),
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url="https://example.supabase.co/storage/v1/object/public/covers/already.jpg",
    )
    session = FakeSession()
    session.scalar_values = [edition]
    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=edition_id,
            source_url="https://covers.openlibrary.org/b/id/1-L.jpg",
        )
    )
    assert result.cached is False
    assert result.cover_url == edition.cover_url


def test_cache_cover_to_storage_follows_redirects() -> None:
    requested: list[str] = []

    def download_handler(request: httpx.Request) -> httpx.Response:
        requested.append(str(request.url))
        if str(request.url) == "https://covers.openlibrary.org/b/id/1-L.jpg":
            return httpx.Response(
                302,
                headers={"Location": "https://archive.org/covers/1-L.jpg"},
            )
        if str(request.url) == "https://archive.org/covers/1-L.jpg":
            return httpx.Response(
                200,
                headers={"Content-Type": "image/jpeg"},
                content=_jpeg_bytes(),
            )
        return httpx.Response(404, json={"error": "unexpected"})

    def upload_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        return httpx.Response(200, json={"Key": "ok"})

    upload = asyncio.run(
        cache_cover_to_storage(
            settings=_settings(),
            source_url="https://covers.openlibrary.org/b/id/1-L.jpg",
            transport=httpx.MockTransport(download_handler),
            storage_transport=httpx.MockTransport(upload_handler),
        )
    )

    assert requested[:2] == [
        "https://covers.openlibrary.org/b/id/1-L.jpg",
        "https://archive.org/covers/1-L.jpg",
    ]
    assert upload.public_url.startswith(
        "https://example.supabase.co/storage/v1/object/public/covers/openlibrary/"
    )


def test_cache_cover_to_storage_rejects_localhost_url() -> None:
    with pytest.raises(ValueError, match="public http\\(s\\) URL"):
        asyncio.run(
            cache_cover_to_storage(
                settings=_settings(),
                source_url="http://localhost/x.jpg",
            )
        )


def test_cache_cover_to_storage_rejects_private_ip_url() -> None:
    with pytest.raises(ValueError, match="public http\\(s\\) URL"):
        asyncio.run(
            cache_cover_to_storage(
                settings=_settings(),
                source_url="http://127.0.0.1/x.jpg",
            )
        )


def test_guess_extension_defaults_to_jpg() -> None:
    assert covers_service._guess_extension("https://example.com/image") == ".jpg"


def test_parse_public_storage_object_url_returns_none_when_invalid() -> None:
    assert (
        covers_service._parse_public_storage_object_url(
            settings=_settings(),
            url="https://example.supabase.co/storage/v1/object/public/covers",
        )
        is None
    )


def test_is_supabase_storage_url_returns_false_when_supabase_url_empty() -> None:
    settings = Settings(
        supabase_url="",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )
    assert (
        covers_service._is_supabase_storage_url(
            settings=settings,
            url="https://example.supabase.co/storage/v1/object/public/covers/x.jpg",
        )
        is False
    )


def test_require_safe_public_http_url_rejects_non_http_scheme() -> None:
    with pytest.raises(ValueError, match="http\\(s\\)"):
        asyncio.run(covers_service._require_safe_public_http_url("ftp://example.com/x"))


def test_cache_cover_to_storage_allows_unparsable_content_length() -> None:
    def download_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "image/jpeg", "Content-Length": "abc"},
            content=_jpeg_bytes(),
        )

    def upload_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        return httpx.Response(200, json={"Key": "ok"})

    upload = asyncio.run(
        cache_cover_to_storage(
            settings=_settings(),
            source_url="https://example.com/image",
            transport=httpx.MockTransport(download_handler),
            storage_transport=httpx.MockTransport(upload_handler),
        )
    )
    assert upload.public_url.startswith(
        "https://example.supabase.co/storage/v1/object/public/covers/openlibrary/"
    )


def test_cache_cover_to_storage_rejects_invalid_image_content() -> None:
    def download_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "image/jpeg"},
            content=b"not an image",
        )

    def upload_handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("should not upload")

    with pytest.raises(ValueError, match="invalid image upload"):
        asyncio.run(
            cache_cover_to_storage(
                settings=_settings(),
                source_url="https://example.com/bad.jpg",
                transport=httpx.MockTransport(download_handler),
                storage_transport=httpx.MockTransport(upload_handler),
            )
        )


def test_cache_cover_updates_edition_without_touching_work_when_work_missing() -> None:
    edition_id = uuid.uuid4()
    edition = Edition(
        id=edition_id,
        work_id=uuid.uuid4(),
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session = FakeSession()
    session.scalar_values = [edition]
    session.get_values = [None]

    def download_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "image/jpeg"},
            content=_jpeg_bytes(),
        )

    def upload_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"Key": "ok"})

    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=edition_id,
            source_url="https://covers.openlibrary.org/b/id/2-L.jpg",
            transport=httpx.MockTransport(download_handler),
            storage_transport=httpx.MockTransport(upload_handler),
        )
    )
    assert result.cached is True
    assert edition.cover_url is not None


def test_parse_public_storage_object_url_returns_none_when_supabase_url_empty() -> None:
    settings = Settings(
        supabase_url="",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )
    assert (
        covers_service._parse_public_storage_object_url(
            settings=settings,
            url="https://example.supabase.co/storage/v1/object/public/covers/x.jpg",
        )
        is None
    )


def test_blocked_hostname_helpers() -> None:
    assert covers_service._is_blocked_hostname("") is True
    assert covers_service._is_blocked_hostname("foo.local") is True
    assert covers_service._is_blocked_hostname("example.com") is False


def test_require_safe_public_http_url_accepts_public_ip_literal() -> None:
    # Should not raise; we only validate the URL host here.
    asyncio.run(covers_service._require_safe_public_http_url("http://8.8.8.8/x.jpg"))


def test_require_safe_public_http_url_rejects_when_dns_resolution_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(covers_service, "_resolve_host_ips", lambda _host: set())
    with pytest.raises(ValueError, match="public http\\(s\\) URL"):
        asyncio.run(
            covers_service._require_safe_public_http_url("https://example.com/x")
        )


def test_require_safe_public_http_url_rejects_when_dns_resolves_private_ip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import ipaddress

    monkeypatch.setattr(
        covers_service,
        "_resolve_host_ips",
        lambda _host: {ipaddress.ip_address("10.0.0.1")},
    )
    with pytest.raises(ValueError, match="public http\\(s\\) URL"):
        asyncio.run(
            covers_service._require_safe_public_http_url("https://example.com/x")
        )


def test_resolve_host_ips_ignores_unknown_families_and_invalid_ips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_getaddrinfo(_host: str, _port: object) -> list[object]:
        return [
            (9999, 0, 0, "", ("not-an-ip", 0)),
            (socket.AF_INET, 0, 0, "", ("256.256.256.256", 0)),
        ]

    monkeypatch.setattr(socket, "getaddrinfo", fake_getaddrinfo)
    assert covers_service._resolve_host_ips("example.com") == set()


def test_cache_cover_to_storage_rejects_large_content_length() -> None:
    def download_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={
                "Content-Type": "image/jpeg",
                "Content-Length": str(10 * 1024 * 1024 + 1),
            },
            content=_jpeg_bytes(),
        )

    def upload_handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("should not upload")

    with pytest.raises(ValueError, match="image is too large"):
        asyncio.run(
            cache_cover_to_storage(
                settings=_settings(),
                source_url="https://example.com/big.jpg",
                transport=httpx.MockTransport(download_handler),
                storage_transport=httpx.MockTransport(upload_handler),
            )
        )


def test_cache_cover_to_storage_rejects_large_body_even_without_content_length(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(covers_service, "_MAX_CACHED_COVER_BYTES", 4)

    def download_handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            headers={"Content-Type": "image/jpeg"},
            content=b"12345",
        )

    def upload_handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("should not upload")

    with pytest.raises(ValueError, match="image is too large"):
        asyncio.run(
            cache_cover_to_storage(
                settings=_settings(),
                source_url="https://example.com/big2.jpg",
                transport=httpx.MockTransport(download_handler),
                storage_transport=httpx.MockTransport(upload_handler),
            )
        )


def test_cache_edition_cover_noops_when_source_url_missing() -> None:
    session = FakeSession()
    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=uuid.uuid4(),
            source_url=None,
        )
    )
    assert result.cached is False
    assert result.cover_url is None
