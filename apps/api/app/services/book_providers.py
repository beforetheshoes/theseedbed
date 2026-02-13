from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient


@dataclass(frozen=True)
class BookAttribution:
    text: str
    url: str | None


@dataclass(frozen=True)
class BookSearchItem:
    source: str
    source_id: str
    work_key: str
    title: str
    author_names: list[str]
    first_publish_year: int | None
    cover_url: str | None
    edition_count: int | None
    languages: list[str]
    readable: bool
    attribution: BookAttribution | None


@dataclass(frozen=True)
class BookSearchResponse:
    items: list[BookSearchItem]
    next_page: int | None
    has_more: bool
    num_found: int | None
    cache_hit: bool


class BookSearchProvider(Protocol):
    provider: str

    async def search_books(
        self,
        *,
        query: str,
        limit: int,
        page: int,
        author: str | None = None,
        subject: str | None = None,
        language: str | None = None,
        first_publish_year_from: int | None = None,
        first_publish_year_to: int | None = None,
        sort: Literal["relevance", "new", "old"] = "relevance",
    ) -> BookSearchResponse: ...


class OpenLibrarySearchProvider:
    provider = "openlibrary"

    def __init__(self, client: OpenLibraryClient) -> None:
        self._client = client

    async def search_books(
        self,
        *,
        query: str,
        limit: int,
        page: int,
        author: str | None = None,
        subject: str | None = None,
        language: str | None = None,
        first_publish_year_from: int | None = None,
        first_publish_year_to: int | None = None,
        sort: Literal["relevance", "new", "old"] = "relevance",
    ) -> BookSearchResponse:
        response = await self._client.search_books(
            query=query,
            limit=limit,
            page=page,
            author=author,
            subject=subject,
            language=language,
            first_publish_year_from=first_publish_year_from,
            first_publish_year_to=first_publish_year_to,
            sort=sort,
        )
        return BookSearchResponse(
            items=[
                BookSearchItem(
                    source=self.provider,
                    source_id=item.work_key,
                    work_key=item.work_key,
                    title=item.title,
                    author_names=item.author_names,
                    first_publish_year=item.first_publish_year,
                    cover_url=item.cover_url,
                    edition_count=item.edition_count,
                    languages=item.languages,
                    readable=item.readable,
                    attribution=None,
                )
                for item in response.items
            ],
            next_page=response.next_page,
            has_more=response.has_more,
            num_found=response.num_found,
            cache_hit=response.cache_hit,
        )


class GoogleBooksSearchProvider:
    provider = "googlebooks"

    def __init__(self, client: GoogleBooksClient) -> None:
        self._client = client

    async def search_books(
        self,
        *,
        query: str,
        limit: int,
        page: int,
        author: str | None = None,
        subject: str | None = None,
        language: str | None = None,
        first_publish_year_from: int | None = None,
        first_publish_year_to: int | None = None,
        sort: Literal["relevance", "new", "old"] = "relevance",
    ) -> BookSearchResponse:
        response = await self._client.search_books(
            query=query,
            limit=limit,
            page=page,
            author=author,
            subject=subject,
            language=language,
            first_publish_year_from=first_publish_year_from,
            first_publish_year_to=first_publish_year_to,
            sort=sort,
        )
        return BookSearchResponse(
            items=[
                BookSearchItem(
                    source=self.provider,
                    source_id=item.volume_id,
                    work_key=f"googlebooks:{item.volume_id}",
                    title=item.title,
                    author_names=item.author_names,
                    first_publish_year=item.first_publish_year,
                    cover_url=item.cover_url,
                    edition_count=None,
                    languages=[item.language] if item.language else [],
                    readable=item.readable,
                    attribution=BookAttribution(
                        text="Data provided by Google Books",
                        url=item.attribution_url,
                    ),
                )
                for item in response.items
            ],
            next_page=response.next_page,
            has_more=response.has_more,
            num_found=response.num_found,
            cache_hit=response.cache_hit,
        )
