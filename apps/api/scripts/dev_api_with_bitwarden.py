#!/usr/bin/env python3
"""Run the API with GOOGLE_BOOKS_API_KEY fetched from Bitwarden Secrets Manager."""

from __future__ import annotations

import os
import sys


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _fetch_google_books_api_key() -> str:
    try:
        from bitwarden_sdk import (  # type: ignore[import-not-found]
            BitwardenClient,
            DeviceType,
            client_settings_from_dict,
        )
    except ImportError as exc:
        raise RuntimeError(
            "bitwarden-sdk is not installed. Run: cd apps/api && uv add --dev bitwarden-sdk"
        ) from exc

    access_token = _require_env("BITWARDEN_ACCESS_TOKEN")
    secret_id = _require_env("GOOGLE_BOOKS_API_KEY_SECRET_ID")

    api_url = os.getenv("BITWARDEN_API_URL", "https://api.bitwarden.com").strip()
    identity_url = os.getenv(
        "BITWARDEN_IDENTITY_URL", "https://identity.bitwarden.com"
    ).strip()
    state_file = os.getenv("BITWARDEN_STATE_FILE", "").strip() or None

    client = BitwardenClient(
        client_settings_from_dict(
            {
                "apiUrl": api_url,
                "deviceType": DeviceType.SDK,
                "identityUrl": identity_url,
                "userAgent": "chapterverse-api-dev",
            }
        )
    )
    client.auth().login_access_token(access_token, state_file)

    response = client.secrets().get_by_ids([secret_id])
    secrets = getattr(getattr(response, "data", None), "data", None)
    if not secrets:
        raise RuntimeError(
            "Bitwarden returned no secrets for GOOGLE_BOOKS_API_KEY_SECRET_ID."
        )

    secret_value = getattr(secrets[0], "value", None)
    if not isinstance(secret_value, str) or not secret_value.strip():
        raise RuntimeError("Bitwarden secret value is empty.")
    return secret_value.strip()


def main() -> int:
    try:
        google_books_api_key = _fetch_google_books_api_key()
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    env = dict(os.environ)
    env["GOOGLE_BOOKS_API_KEY"] = google_books_api_key
    env.setdefault("BOOK_PROVIDER_GOOGLE_ENABLED", "true")

    port = os.getenv("API_PORT", "8000").strip() or "8000"
    cmd = [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--port", port]

    print("Starting API with Google Books key loaded from Bitwarden...")
    os.execvpe(cmd[0], cmd, env)


if __name__ == "__main__":
    raise SystemExit(main())
