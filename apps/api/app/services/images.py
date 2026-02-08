from __future__ import annotations

import io

from PIL import Image, ImageOps


class ImageValidationError(ValueError):
    pass


def _looks_like_svg(content: bytes) -> bool:
    head = content[:2048].lstrip().lower()
    return head.startswith(b"<svg") or b"<svg" in head


def normalize_cover_image(
    *,
    content: bytes,
    content_type: str | None,
    max_bytes: int,
    max_dimension: int,
) -> tuple[bytes, str]:
    if len(content) > max_bytes:
        raise ImageValidationError("image is too large")

    raw_ct = (content_type or "").split(";", 1)[0].strip().lower()
    if raw_ct in {"image/svg+xml", "text/xml", "application/xml"} or _looks_like_svg(
        content
    ):
        raise ImageValidationError("svg uploads are not allowed")

    try:
        with Image.open(io.BytesIO(content)) as img:
            img.load()
            if img.format not in {"JPEG", "PNG", "WEBP"}:
                raise ImageValidationError("unsupported image format")

            width, height = img.size
            if width <= 0 or height <= 0:
                raise ImageValidationError("invalid image dimensions")
            if width > max_dimension or height > max_dimension:
                raise ImageValidationError("image dimensions are too large")

            # Strip metadata and normalize orientation; always store covers as JPEG.
            normalized: Image.Image = ImageOps.exif_transpose(img)
            if normalized.mode in {"RGBA", "LA"} or (
                normalized.mode == "P" and "transparency" in normalized.info
            ):
                background = Image.new("RGB", normalized.size, (255, 255, 255))
                rgba = normalized.convert("RGBA")
                background.paste(rgba, mask=rgba.split()[-1])
                out = background
            else:
                out = normalized.convert("RGB")

            buf = io.BytesIO()
            out.save(buf, format="JPEG", quality=85, optimize=True)
            return buf.getvalue(), "image/jpeg"
    except ImageValidationError:
        raise
    except Exception as exc:
        raise ImageValidationError("invalid image upload") from exc
