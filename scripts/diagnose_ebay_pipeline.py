#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"
OCR_SCRIPT = ROOT / "scripts" / "vision_ocr.swift"


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env

    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        env[key.strip()] = value.strip()

    return env


def get_token(env: dict[str, str]) -> tuple[str, str]:
    client_id = env["EBAY_CLIENT_ID"]
    client_secret = env["EBAY_CLIENT_SECRET"]
    marketplace = env.get("EBAY_MARKETPLACE_ID", "EBAY_US")

    response = requests.post(
        "https://api.ebay.com/identity/v1/oauth2/token",
        headers={
            "Authorization": "Basic "
            + base64.b64encode(f"{client_id}:{client_secret}".encode()).decode(),
            "Content-Type": "application/x-www-form-urlencoded",
        },
        data={
            "grant_type": "client_credentials",
            "scope": "https://api.ebay.com/oauth/api_scope",
        },
        timeout=20,
    )
    response.raise_for_status()
    return response.json()["access_token"], marketplace


def ebay_headers(token: str, marketplace: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "X-EBAY-C-MARKETPLACE-ID": marketplace,
        "Accept": "application/json",
    }


def search_text(token: str, marketplace: str, query: str, limit: int = 8) -> dict:
    started_at = time.time()
    response = requests.get(
        "https://api.ebay.com/buy/browse/v1/item_summary/search",
        headers=ebay_headers(token, marketplace),
        params={
            "q": query,
            "limit": str(limit),
            "filter": "conditions:{USED},buyingOptions:{FIXED_PRICE}",
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return {
        "latencyMs": int((time.time() - started_at) * 1000),
        "items": payload.get("itemSummaries", []),
    }


def search_by_image(token: str, marketplace: str, image_bytes: bytes, limit: int = 8) -> dict:
    started_at = time.time()
    response = requests.post(
        "https://api.ebay.com/buy/browse/v1/item_summary/search_by_image",
        headers={**ebay_headers(token, marketplace), "Content-Type": "application/json"},
        params={
            "limit": str(limit),
            "fieldgroups": "FULL",
            "filter": "conditions:{USED},buyingOptions:{FIXED_PRICE}",
        },
        json={"image": base64.b64encode(image_bytes).decode()},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    return {
        "latencyMs": int((time.time() - started_at) * 1000),
        "dominantCategoryId": payload.get("refinement", {}).get("dominantCategoryId"),
        "items": payload.get("itemSummaries", []),
    }


def summarize_items(items: list[dict], limit: int = 5) -> list[dict]:
    summary = []
    for item in items[:limit]:
        categories = [
            category.get("categoryName")
            for category in item.get("categories", [])
            if category.get("categoryName")
        ]
        summary.append(
            {
                "title": item.get("title"),
                "price": item.get("price", {}).get("value"),
                "categoryPath": " > ".join(categories[:3]),
                "imageUrl": item.get("image", {}).get("imageUrl"),
            }
        )
    return summary


def run_ocr(paths: list[Path]) -> list[dict]:
    if not OCR_SCRIPT.exists() or not shutil_which("swift"):
        return []

    process = subprocess.run(
        ["/usr/bin/swift", str(OCR_SCRIPT), *[str(path) for path in paths]],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(process.stdout)


def shutil_which(binary: str) -> str | None:
    for directory in os.environ.get("PATH", "").split(":"):
        path = Path(directory) / binary
        if path.exists():
            return str(path)
    return None


def diagnose_local_case(token: str, marketplace: str, paths: list[Path], truth_query: str) -> dict:
    ocr = run_ocr(paths)
    per_image = []

    for path in paths:
        image_search = search_by_image(token, marketplace, path.read_bytes())
        per_image.append(
            {
                "path": str(path),
                "searchByImageLatencyMs": image_search["latencyMs"],
                "dominantCategoryId": image_search["dominantCategoryId"],
                "topResults": summarize_items(image_search["items"]),
            }
        )

    text_search = search_text(token, marketplace, truth_query)
    return {
        "case": "local_images",
        "truthQuery": truth_query,
        "ocr": ocr,
        "perImage": per_image,
        "truthQueryResults": summarize_items(text_search["items"]),
        "truthQueryLatencyMs": text_search["latencyMs"],
    }


def diagnose_remote_seed_case(token: str, marketplace: str, seed_query: str) -> dict:
    text_search = search_text(token, marketplace, seed_query, limit=1)
    if not text_search["items"]:
        return {"case": "remote_seed", "seedQuery": seed_query, "error": "no_seed_results"}

    seed = text_search["items"][0]
    image_url = seed.get("image", {}).get("imageUrl")
    image_response = requests.get(image_url, timeout=30)
    image_response.raise_for_status()
    image_search = search_by_image(token, marketplace, image_response.content)

    return {
        "case": "remote_seed",
        "seedQuery": seed_query,
        "seedTitle": seed.get("title"),
        "seedImageUrl": image_url,
        "searchByImageLatencyMs": image_search["latencyMs"],
        "topResults": summarize_items(image_search["items"]),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        default="-",
        help="JSON report path. Use - for stdout.",
    )
    args = parser.parse_args()

    env = load_env(ENV_FILE)
    if "EBAY_CLIENT_ID" not in env or "EBAY_CLIENT_SECRET" not in env:
        print(".env.local に eBay の認証情報がありません。", file=sys.stderr)
        return 1

    token, marketplace = get_token(env)

    watch_dir = ROOT / "test_pictures" / "watch"
    local_report = diagnose_local_case(
        token,
        marketplace,
        [
            watch_dir / "S__35241987_0.jpg",
            watch_dir / "S__35241988_0.jpg",
            watch_dir / "S__35241989_0.jpg",
        ],
        "Rolex Air-King 114210 34mm",
    )

    remote_reports = [
        diagnose_remote_seed_case(token, marketplace, "Rolex Air King 14000"),
        diagnose_remote_seed_case(token, marketplace, "Coach Tabby 26 bag"),
        diagnose_remote_seed_case(token, marketplace, "iPhone 13 Pro 128GB"),
    ]

    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "marketplace": marketplace,
        "reports": [local_report, *remote_reports],
    }

    output = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output == "-":
        print(output)
    else:
        Path(args.output).write_text(output)
        print(args.output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
