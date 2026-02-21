from __future__ import annotations

from app.services.auto_enrichment import _build_auto_selections, _candidate_confidence


def test_candidate_confidence_high_when_cover_and_identifier_present() -> None:
    fields = [
        {
            "field_key": "work.cover_url",
            "candidates": [
                {
                    "provider": "openlibrary",
                    "provider_id": "/works/1",
                    "value": "https://img",
                }
            ],
        },
        {
            "field_key": "edition.isbn13",
            "candidates": [
                {
                    "provider": "openlibrary",
                    "provider_id": "/books/1",
                    "value": "9780123456789",
                }
            ],
        },
    ]

    confidence, score = _candidate_confidence(fields)

    assert confidence == "high"
    assert score > 0.9


def test_candidate_confidence_medium_when_cover_and_metadata_only() -> None:
    fields = [
        {
            "field_key": "work.cover_url",
            "candidates": [
                {
                    "provider": "googlebooks",
                    "provider_id": "gb1",
                    "value": "https://img",
                }
            ],
        },
        {
            "field_key": "edition.publisher",
            "candidates": [
                {"provider": "googlebooks", "provider_id": "gb1", "value": "Pub"}
            ],
        },
    ]

    confidence, _ = _candidate_confidence(fields)

    assert confidence == "medium"


def test_build_auto_selections_prefers_openlibrary_for_high_confidence() -> None:
    fields = [
        {
            "field_key": "work.cover_url",
            "current_value": None,
            "candidates": [
                {"provider": "googlebooks", "provider_id": "gb1", "value": "https://g"},
                {
                    "provider": "openlibrary",
                    "provider_id": "/works/1",
                    "value": "https://o",
                },
            ],
        },
        {
            "field_key": "edition.publisher",
            "current_value": None,
            "candidates": [
                {"provider": "openlibrary", "provider_id": "/books/1", "value": "Pub"}
            ],
        },
    ]

    selections = _build_auto_selections(
        fields=fields,
        confidence="high",
        auto_apply_covers=True,
        auto_apply_metadata=True,
    )

    assert len(selections) == 2
    assert selections[0]["provider"] == "openlibrary"
    assert selections[1]["field_key"] == "edition.publisher"


def test_build_auto_selections_medium_confidence_cover_only() -> None:
    fields = [
        {
            "field_key": "work.cover_url",
            "current_value": None,
            "candidates": [
                {
                    "provider": "openlibrary",
                    "provider_id": "/works/1",
                    "value": "https://o",
                }
            ],
        },
        {
            "field_key": "edition.publisher",
            "current_value": None,
            "candidates": [
                {"provider": "openlibrary", "provider_id": "/books/1", "value": "Pub"}
            ],
        },
    ]

    selections = _build_auto_selections(
        fields=fields,
        confidence="medium",
        auto_apply_covers=True,
        auto_apply_metadata=True,
    )

    assert len(selections) == 1
    assert selections[0]["field_key"] == "work.cover_url"
