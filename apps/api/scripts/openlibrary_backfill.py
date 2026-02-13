from __future__ import annotations

import argparse
import asyncio
import json

from app.services.openlibrary_backfill import run_openlibrary_backfill


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Backfill OpenLibrary metadata for works missing key fields."
    )
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--retries", type=int, default=3)
    return parser.parse_args()


async def _main() -> None:
    args = parse_args()
    result = await run_openlibrary_backfill(
        limit=max(args.limit, 1),
        concurrency=max(args.concurrency, 1),
        retries=max(args.retries, 1),
    )
    print(
        json.dumps(
            {
                "scanned": result.scanned,
                "processed": result.processed,
                "refreshed": result.refreshed,
                "failed": result.failed,
            }
        )
    )


if __name__ == "__main__":
    asyncio.run(_main())
