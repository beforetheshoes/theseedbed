from __future__ import annotations

import io

import pytest
from PIL import Image

from app.services.images import ImageValidationError, normalize_cover_image


def _jpeg_bytes() -> bytes:
    img = Image.new("RGB", (20, 30), (200, 100, 50))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_normalize_cover_image_rejects_svg() -> None:
    with pytest.raises(ImageValidationError, match="svg"):
        normalize_cover_image(
            content=b"<svg xmlns='http://www.w3.org/2000/svg'></svg>",
            content_type="image/svg+xml",
            max_bytes=1024,
            max_dimension=4000,
        )


def test_normalize_cover_image_rejects_large_payload() -> None:
    with pytest.raises(ImageValidationError, match="too large"):
        normalize_cover_image(
            content=b"x" * 20,
            content_type="image/jpeg",
            max_bytes=10,
            max_dimension=4000,
        )


def test_normalize_cover_image_outputs_jpeg() -> None:
    out_bytes, out_ct = normalize_cover_image(
        content=_jpeg_bytes(),
        content_type="image/jpeg",
        max_bytes=1024 * 1024,
        max_dimension=4000,
    )
    assert out_ct == "image/jpeg"
    assert out_bytes.startswith(b"\xff\xd8")


def test_normalize_cover_image_rejects_unsupported_format() -> None:
    img = Image.new("RGB", (20, 20), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="GIF")
    with pytest.raises(ImageValidationError, match="unsupported"):
        normalize_cover_image(
            content=buf.getvalue(),
            content_type="image/gif",
            max_bytes=1024 * 1024,
            max_dimension=4000,
        )


def test_normalize_cover_image_rejects_large_dimensions() -> None:
    img = Image.new("RGB", (20, 20), (0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    with pytest.raises(ImageValidationError, match="dimensions"):
        normalize_cover_image(
            content=buf.getvalue(),
            content_type="image/jpeg",
            max_bytes=1024 * 1024,
            max_dimension=10,
        )


def test_normalize_cover_image_accepts_transparent_png() -> None:
    img = Image.new("RGBA", (20, 20), (255, 0, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    out_bytes, out_ct = normalize_cover_image(
        content=buf.getvalue(),
        content_type="image/png",
        max_bytes=1024 * 1024,
        max_dimension=4000,
    )
    assert out_ct == "image/jpeg"
    assert out_bytes.startswith(b"\xff\xd8")


def test_normalize_cover_image_rejects_invalid_bytes() -> None:
    with pytest.raises(ImageValidationError, match="invalid image upload"):
        normalize_cover_image(
            content=b"not-an-image",
            content_type="image/jpeg",
            max_bytes=1024 * 1024,
            max_dimension=4000,
        )


def test_normalize_cover_image_rejects_invalid_dimensions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeImage:
        format = "JPEG"
        size = (0, 10)

        def load(self) -> None:
            return None

        def __enter__(self) -> FakeImage:
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    monkeypatch.setattr(
        "app.services.images.Image.open", lambda *_args, **_kwargs: FakeImage()
    )

    with pytest.raises(ImageValidationError, match="invalid image dimensions"):
        normalize_cover_image(
            content=b"fake",
            content_type="image/jpeg",
            max_bytes=1024 * 1024,
            max_dimension=4000,
        )
