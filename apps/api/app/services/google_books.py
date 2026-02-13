from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Any

import httpx

_YEAR_RE = re.compile(r"(\d{4})")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


@dataclass(frozen=True)
class GoogleBooksSearchResult:
    volume_id: str
    title: str
    author_names: list[str]
    first_publish_year: int | None
    cover_url: str | None
    language: str | None
    readable: bool
    attribution_url: str | None


@dataclass(frozen=True)
class GoogleBooksSearchResponse:
    items: list[GoogleBooksSearchResult]
    query: str
    limit: int
    page: int
    num_found: int | None
    has_more: bool
    next_page: int | None
    cache_hit: bool


@dataclass(frozen=True)
class GoogleBooksWorkBundle:
    volume_id: str
    title: str
    description: str | None
    first_publish_year: int | None
    cover_url: str | None
    authors: list[str]
    edition: dict[str, Any] | None
    raw_volume: dict[str, Any]
    attribution_url: str | None


def _parse_publish_year(raw: Any) -> int | None:
    if isinstance(raw, int):
        return raw if 0 < raw < 10000 else None
    if isinstance(raw, str):
        matched = _YEAR_RE.search(raw)
        if not matched:
            return None
        parsed = int(matched.group(1))
        return parsed if 0 < parsed < 10000 else None
    return None


def _parse_publish_date(raw: Any) -> dt.date | None:
    if not isinstance(raw, str):
        return None
    value = raw.strip()
    if not _ISO_DATE_RE.match(value):
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def _normalize_cover_url(url: Any) -> str | None:
    if not isinstance(url, str):
        return None
    value = url.strip()
    if not value:
        return None
    if value.startswith("http://"):
        return f"https://{value.removeprefix('http://')}"
    return value


def _extract_isbn(identifiers: Any, *, isbn_type: str) -> str | None:
    if not isinstance(identifiers, list):
        return None
    for item in identifiers:
        if not isinstance(item, dict):
            continue
        raw_type = item.get("type")
        raw_value = item.get("identifier")
        if not isinstance(raw_type, str) or not isinstance(raw_value, str):
            continue
        if raw_type.strip().upper() != isbn_type:
            continue
        value = raw_value.strip().replace("-", "")
        if value:
            return value
    return None


class GoogleBooksClient:
    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str = "https://www.googleapis.com/books/v1",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._transport = transport

    async def _request_json(
        self,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
    ) -> dict[str, Any]:
        merged_params = dict(params or {})
        if self._api_key:
            merged_params["key"] = self._api_key
        timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            transport=self._transport,
        ) as client:
            response = await client.get(
                f"{self._base_url}{path}",
                params=merged_params,
            )
            response.raise_for_status()
            payload = response.json()
        if not isinstance(payload, dict):
            raise RuntimeError("google books request returned non-object payload")
        return payload

    async def search_books(
        self,
        *,
        query: str,
        limit: int = 10,
        page: int = 1,
        author: str | None = None,
        subject: str | None = None,
        language: str | None = None,
        first_publish_year_from: int | None = None,
        first_publish_year_to: int | None = None,
        sort: str = "relevance",
    ) -> GoogleBooksSearchResponse:
        trimmed = query.strip()
        if not trimmed:
            return GoogleBooksSearchResponse(
                items=[],
                query="",
                limit=limit,
                page=page,
                num_found=0,
                has_more=False,
                next_page=None,
                cache_hit=False,
            )

        max_results = max(1, min(limit, 40))
        page_value = max(page, 1)
        start_index = (page_value - 1) * max_results
        q_parts = [trimmed]
        if author:
            q_parts.append(f"inauthor:{author.strip()}")
        if subject:
            q_parts.append(f"subject:{subject.strip()}")
        q_value = " ".join(part for part in q_parts if part)
        params: dict[str, str | int] = {
            "q": q_value,
            "maxResults": max_results,
            "startIndex": start_index,
            "printType": "books",
        }
        if language and language.strip():
            params["langRestrict"] = language.strip().lower()
        if sort == "new":
            params["orderBy"] = "newest"

        payload = await self._request_json("/volumes", params=params)
        raw_items = payload.get("items")
        total_items = payload.get("totalItems")
        items: list[GoogleBooksSearchResult] = []
        if isinstance(raw_items, list):
            for raw_item in raw_items:
                if not isinstance(raw_item, dict):
                    continue
                volume_id = raw_item.get("id")
                if not isinstance(volume_id, str) or not volume_id.strip():
                    continue
                volume_info = raw_item.get("volumeInfo")
                if not isinstance(volume_info, dict):
                    continue
                title = volume_info.get("title")
                if not isinstance(title, str) or not title.strip():
                    continue
                published_date = volume_info.get("publishedDate")
                first_publish_year = _parse_publish_year(published_date)
                if (
                    first_publish_year_from is not None
                    and first_publish_year is not None
                    and first_publish_year < first_publish_year_from
                ):
                    continue
                if (
                    first_publish_year_to is not None
                    and first_publish_year is not None
                    and first_publish_year > first_publish_year_to
                ):
                    continue

                raw_authors = volume_info.get("authors")
                author_names: list[str] = []
                if isinstance(raw_authors, list):
                    author_names = [
                        author.strip()
                        for author in raw_authors
                        if isinstance(author, str) and author.strip()
                    ]

                image_links = volume_info.get("imageLinks")
                thumbnail = (
                    image_links.get("thumbnail")
                    if isinstance(image_links, dict)
                    else None
                )
                cover_url = _normalize_cover_url(thumbnail)
                language_code = volume_info.get("language")
                access_info = raw_item.get("accessInfo")
                readable = False
                if isinstance(access_info, dict):
                    viewability = access_info.get("viewability")
                    if isinstance(viewability, str):
                        readable = viewability.upper() != "NO_PAGES"

                info_link = volume_info.get("canonicalVolumeLink")
                if not isinstance(info_link, str) or not info_link.strip():
                    info_link = volume_info.get("infoLink")

                items.append(
                    GoogleBooksSearchResult(
                        volume_id=volume_id,
                        title=title.strip(),
                        author_names=author_names,
                        first_publish_year=first_publish_year,
                        cover_url=cover_url,
                        language=(
                            language_code.strip().lower()
                            if isinstance(language_code, str) and language_code.strip()
                            else None
                        ),
                        readable=readable,
                        attribution_url=(
                            info_link.strip()
                            if isinstance(info_link, str) and info_link.strip()
                            else None
                        ),
                    )
                )

        num_found = total_items if isinstance(total_items, int) else None
        has_more = (
            bool(num_found is not None and start_index + len(items) < num_found)
            if num_found is not None
            else len(items) >= max_results
        )
        next_page = page_value + 1 if has_more else None

        return GoogleBooksSearchResponse(
            items=items,
            query=trimmed,
            limit=max_results,
            page=page_value,
            num_found=num_found,
            has_more=has_more,
            next_page=next_page,
            cache_hit=False,
        )

    async def fetch_work_bundle(self, *, volume_id: str) -> GoogleBooksWorkBundle:
        normalized_volume_id = volume_id.strip()
        if not normalized_volume_id:
            raise ValueError("volume_id is required")

        payload = await self._request_json(f"/volumes/{normalized_volume_id}")
        volume_info = payload.get("volumeInfo")
        if not isinstance(volume_info, dict):
            raise LookupError("google books volume missing volumeInfo")

        title = volume_info.get("title")
        if not isinstance(title, str) or not title.strip():
            raise LookupError("google books volume missing title")

        authors_raw = volume_info.get("authors")
        authors = (
            [
                value.strip()
                for value in authors_raw
                if isinstance(value, str) and value.strip()
            ]
            if isinstance(authors_raw, list)
            else []
        )
        image_links = volume_info.get("imageLinks")
        cover_url = _normalize_cover_url(
            image_links.get("thumbnail") if isinstance(image_links, dict) else None
        )
        language = volume_info.get("language")
        identifiers = volume_info.get("industryIdentifiers")
        published_date = volume_info.get("publishedDate")
        publish_date_iso = _parse_publish_date(published_date)
        first_publish_year = _parse_publish_year(published_date)
        isbn10 = _extract_isbn(identifiers, isbn_type="ISBN_10")
        isbn13 = _extract_isbn(identifiers, isbn_type="ISBN_13")
        publisher = volume_info.get("publisher")
        print_type = volume_info.get("printType")
        info_link = volume_info.get("canonicalVolumeLink")
        if not isinstance(info_link, str) or not info_link.strip():
            info_link = volume_info.get("infoLink")

        edition: dict[str, Any] | None = None
        if isbn10 or isbn13 or publish_date_iso or publisher or language or print_type:
            edition = {
                "isbn10": isbn10,
                "isbn13": isbn13,
                "publisher": (
                    publisher.strip()
                    if isinstance(publisher, str) and publisher.strip()
                    else None
                ),
                "publish_date_iso": publish_date_iso,
                "language": (
                    language.strip().lower()
                    if isinstance(language, str) and language.strip()
                    else None
                ),
                "format": (
                    print_type.strip().lower()
                    if isinstance(print_type, str) and print_type.strip()
                    else None
                ),
            }

        description = volume_info.get("description")
        return GoogleBooksWorkBundle(
            volume_id=normalized_volume_id,
            title=title.strip(),
            description=description.strip() if isinstance(description, str) else None,
            first_publish_year=first_publish_year,
            cover_url=cover_url,
            authors=authors,
            edition=edition,
            raw_volume=payload,
            attribution_url=info_link.strip() if isinstance(info_link, str) else None,
        )
