#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import re
import shutil
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"
OUTPUT_ROOT = ROOT / "benchmark" / "ebay_identification_v1"

GLOBAL_STOPWORDS = {
    "a",
    "an",
    "and",
    "authentic",
    "bag",
    "blue",
    "brown",
    "excellent",
    "from",
    "gold",
    "good",
    "in",
    "japan",
    "large",
    "men",
    "mens",
    "new",
    "no",
    "of",
    "pre",
    "owned",
    "silver",
    "small",
    "steel",
    "the",
    "used",
    "vintage",
    "watch",
    "white",
    "with",
    "women",
    "womens",
}

GLOBAL_BANNED_TITLE_KEYWORDS = [
    "box only",
    "case only",
    "empty box",
    "for parts",
    "manual",
    "lot of",
    "parts",
    "repair",
    "replica",
]

REFERENCE_PATTERNS = [
    re.compile(r"\b[a-z]{0,3}\d{3,8}[a-z]{0,3}\b", re.IGNORECASE),
    re.compile(r"\b\d{2,4}mm\b", re.IGNORECASE),
]

IMPORTANT_ASPECTS = {
    "Type",
    "Material",
    "Metal",
    "Metal Purity",
    "Brand",
    "Model",
    "Style",
    "Department",
    "Color",
    "Pattern",
    "Main Stone",
    "Year",
    "Denomination",
    "Composition",
    "Certification",
    "Country/Region of Manufacture",
    "Theme",
    "Artist",
    "Subject",
    "Original/Licensed Reproduction",
}


@dataclass
class CategoryConfig:
    key: str
    label_ja: str
    image_dir: str
    target_count: int
    max_per_query_first_pass: int
    min_price_usd: float
    queries: list[str]
    allowed_category_keywords: list[str]
    banned_category_keywords: list[str]
    required_title_keywords: list[str]
    banned_title_keywords: list[str]
    preferred_brands: list[str]


CATEGORY_CONFIGS: list[CategoryConfig] = [
    CategoryConfig(
        key="brand_bag",
        label_ja="ブランドバッグ",
        image_dir="brand_bag",
        target_count=30,
        max_per_query_first_pass=3,
        min_price_usd=120,
        queries=[
            "louis vuitton speedy handbag",
            "coach tabby shoulder bag",
            "gucci marmont bag",
            "prada nylon bag",
            "chanel flap bag",
            "fendi baguette bag",
            "celine luggage bag",
            "saint laurent sunset bag",
            "burberry tote bag",
            "balenciaga city bag",
            "bottega veneta cassette bag",
            "dior saddle bag",
        ],
        allowed_category_keywords=["bags & handbags", "handbags", "satchels", "crossbody", "shoulder bag"],
        banned_category_keywords=[],
        required_title_keywords=[],
        banned_title_keywords=["wallet", "strap", "pouch", "dust bag", "card case", "key case", "coin purse"],
        preferred_brands=[
            "Louis Vuitton",
            "Coach",
            "Gucci",
            "Prada",
            "Chanel",
            "Fendi",
            "Celine",
            "Saint Laurent",
            "Burberry",
            "Balenciaga",
            "Bottega Veneta",
            "Dior",
        ],
    ),
    CategoryConfig(
        key="jewelry_precious_metals",
        label_ja="ジュエリー・貴金属",
        image_dir="jewelry_precious_metals",
        target_count=30,
        max_per_query_first_pass=3,
        min_price_usd=60,
        queries=[
            "cartier love ring",
            "tiffany sterling silver necklace",
            "van cleef bracelet",
            "mikimoto pearl necklace",
            "18k gold chain necklace",
            "14k gold bracelet",
            "platinum diamond ring",
            "diamond stud earrings 14k",
            "sterling silver bracelet",
            "18k gold pendant",
            "cartier trinity ring",
            "gold hoop earrings 18k",
        ],
        allowed_category_keywords=["fine jewelry", "necklaces", "pendants", "rings", "bracelets", "earrings"],
        banned_category_keywords=[],
        required_title_keywords=[],
        banned_title_keywords=["scrap", "melt", "lot", "moissanite", "loose diamond", "gemstone lot", "box only"],
        preferred_brands=["Cartier", "Tiffany & Co.", "Van Cleef & Arpels", "Mikimoto"],
    ),
    CategoryConfig(
        key="apparel",
        label_ja="アパレル",
        image_dir="apparel",
        target_count=30,
        max_per_query_first_pass=3,
        min_price_usd=40,
        queries=[
            "burberry trench coat",
            "moncler down jacket",
            "supreme hoodie",
            "levis denim jacket",
            "patagonia fleece jacket",
            "arcteryx shell jacket",
            "polo ralph lauren shirt",
            "north face puffer jacket",
            "comme des garcons shirt",
            "issey miyake pleats please",
            "stone island sweatshirt",
            "yohji yamamoto coat",
        ],
        allowed_category_keywords=["clothing", "shirts", "coats", "jackets", "vests", "sweaters", "hoodies", "pants"],
        banned_category_keywords=[],
        required_title_keywords=[],
        banned_title_keywords=["lot", "bundle", "patch", "fabric", "button", "cap", "hat", "vest only"],
        preferred_brands=[
            "Burberry",
            "Moncler",
            "Supreme",
            "Levi's",
            "Patagonia",
            "Arc'teryx",
            "Polo Ralph Lauren",
            "The North Face",
            "Comme Des Garcons",
            "Issey Miyake",
            "Stone Island",
            "Yohji Yamamoto",
        ],
    ),
    CategoryConfig(
        key="watch",
        label_ja="時計",
        image_dir="watch",
        target_count=30,
        max_per_query_first_pass=3,
        min_price_usd=120,
        queries=[
            "rolex air king watch",
            "omega speedmaster watch",
            "seiko diver watch",
            "cartier tank watch",
            "tag heuer carrera watch",
            "breitling navitimer watch",
            "tudor black bay watch",
            "g shock dw5600 watch",
            "grand seiko watch",
            "longines hydroconquest watch",
            "citizen eco drive watch",
            "hamilton khaki watch",
        ],
        allowed_category_keywords=["wristwatches"],
        banned_category_keywords=["watch parts", "wristwatch bands", "watch accessories"],
        required_title_keywords=[],
        banned_title_keywords=[
            "band",
            "bracelet",
            "strap",
            "dial",
            "bezel",
            "movement",
            "parts",
            "card only",
            "papers only",
            "box only",
            "head only",
            "case only",
            "link",
        ],
        preferred_brands=[
            "Rolex",
            "Omega",
            "Seiko",
            "Cartier",
            "TAG Heuer",
            "Breitling",
            "Tudor",
            "Casio",
            "Grand Seiko",
            "Longines",
            "Citizen",
            "Hamilton",
        ],
    ),
    CategoryConfig(
        key="coins",
        label_ja="古銭",
        image_dir="coins",
        target_count=30,
        max_per_query_first_pass=3,
        min_price_usd=15,
        queries=[
            "morgan silver dollar raw coin",
            "peace dollar raw coin",
            "saint gaudens 20 dollar gold coin",
            "walking liberty half dollar raw coin",
            "buffalo nickel raw coin",
            "mercury dime silver coin",
            "indian head cent raw coin",
            "ancient roman bronze coin",
            "japanese meiji silver coin",
            "trade dollar silver coin",
            "seated liberty quarter raw coin",
            "seated liberty dime coin",
            "barber half dollar raw coin",
            "barber quarter raw coin",
            "barber dime raw coin",
            "large cent copper coin",
            "draped bust large cent coin",
            "flying eagle cent coin",
            "liberty head nickel raw coin",
            "capped bust half dollar coin",
            "ancient greek silver coin",
            "confederate currency note",
            "confederate 50 dollar note",
            "silver certificate note",
            "fractional currency note",
            "large size us note",
            "national bank note large size",
            "obsolete bank note",
            "japanese military currency note",
            "obsolete banknote 1800s",
        ],
        allowed_category_keywords=[],
        banned_category_keywords=[
            "supplies",
            "albums",
            "folders",
            "holders",
            "bullion",
            "collections & lots",
            "jewelry",
            "fashion jewelry",
            "wallets",
            "belt buckles",
            "bracelets",
            "charms",
            "ccg individual cards",
            "other art",
            "books",
            "advertising",
            "golf shoes",
            "antiquarian",
        ],
        required_title_keywords=["coin", "dollar", "cent", "nickel", "dime", "quarter", "note", "banknote", "currency"],
        banned_title_keywords=[
            "copy",
            "replica",
            "album",
            "folder",
            "holder",
            "lot",
            "token",
            "medal",
            "commemorative set",
            "case only",
            "no coins",
            "necklace",
            "bracelet",
            "earrings",
            "pendant",
            "ring",
            "book",
            "clock",
            "paperweight",
            "coaster",
            "wallet",
            "money clip",
            "buckle",
            "charm",
            "keepsake",
            "framed",
            "frame",
            "card",
            "cgc",
            "pokemon",
            "yugioh",
            "guide to",
            "buyer's guide",
        ],
        preferred_brands=[],
    ),
    CategoryConfig(
        key="antiques_art",
        label_ja="骨董品・美術品類",
        image_dir="antiques_art",
        target_count=30,
        max_per_query_first_pass=3,
        min_price_usd=40,
        queries=[
            "kutani vase antique",
            "satsuma vase antique",
            "cloisonne vase antique",
            "japanese woodblock print",
            "antique oil painting",
            "signed lithograph art",
            "bronze statue antique",
            "imari plate antique",
            "watercolor painting antique",
            "japanese lacquer box antique",
            "meiji bronze vase",
            "art pottery vase vintage",
        ],
        allowed_category_keywords=["antiques", "art", "asian antiques", "paintings", "prints", "sculptures", "pottery", "glass"],
        banned_category_keywords=[],
        required_title_keywords=[],
        banned_title_keywords=["reproduction", "print copy", "poster", "frame only", "lot", "book", "catalog"],
        preferred_brands=[],
    ),
]


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


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).lower()
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def slugify(value: str) -> str:
    value = normalize_text(value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def tokenize_title(value: str) -> list[str]:
    value = normalize_text(value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return [token for token in value.split() if token and token not in GLOBAL_STOPWORDS]


def extract_reference_tokens(value: str) -> list[str]:
    seen: list[str] = []
    for pattern in REFERENCE_PATTERNS:
        for match in pattern.findall(value):
            token = match.lower()
            if token not in seen:
                seen.append(token)
    return seen


def get_access_token(session: requests.Session, env: dict[str, str]) -> tuple[str, str]:
    client_id = env["EBAY_CLIENT_ID"]
    client_secret = env["EBAY_CLIENT_SECRET"]
    marketplace = env.get("EBAY_MARKETPLACE_ID", "EBAY_US")
    response = session.post(
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


def search_items(
    session: requests.Session,
    token: str,
    marketplace: str,
    query: str,
    limit: int = 50,
) -> list[dict[str, Any]]:
    response = session.get(
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
    return response.json().get("itemSummaries", [])


def get_item_detail(
    session: requests.Session,
    token: str,
    marketplace: str,
    item_href: str,
) -> dict[str, Any]:
    response = session.get(item_href, headers=ebay_headers(token, marketplace), timeout=30)
    response.raise_for_status()
    return response.json()


def flatten_aspects(detail: dict[str, Any]) -> dict[str, str]:
    output: dict[str, str] = {}
    for aspect in detail.get("localizedAspects", []) or []:
        name = aspect.get("name")
        value = aspect.get("value")
        if not name or not value:
            continue
        output[str(name)] = str(value)
    return output


def get_price_value(detail: dict[str, Any]) -> float:
    price = detail.get("price", {})
    try:
        return float(price.get("value", 0))
    except (TypeError, ValueError):
        return 0.0


def get_brand(detail: dict[str, Any], config: CategoryConfig, aspects: dict[str, str]) -> str | None:
    candidates = [detail.get("brand"), detail.get("product", {}).get("brand"), aspects.get("Brand")]
    for candidate in candidates:
        if candidate:
            return str(candidate).strip()

    normalized_title = normalize_text(str(detail.get("title", "")))
    for brand in config.preferred_brands:
        if normalize_text(brand) in normalized_title:
            return brand
    return None


def allow_category_path(category_path: str, config: CategoryConfig) -> bool:
    normalized = normalize_text(category_path)
    if config.allowed_category_keywords and not any(
        keyword in normalized for keyword in config.allowed_category_keywords
    ):
        return False
    if any(keyword in normalized for keyword in config.banned_category_keywords):
        return False
    return True


def has_required_title_keyword(title: str, config: CategoryConfig) -> bool:
    if not config.required_title_keywords:
        return True
    normalized = normalize_text(title)
    return any(keyword in normalized for keyword in config.required_title_keywords)


def is_banned_title(title: str, config: CategoryConfig) -> bool:
    normalized = normalize_text(title)
    for keyword in [*GLOBAL_BANNED_TITLE_KEYWORDS, *config.banned_title_keywords]:
        if keyword in normalized:
            return True
    return False


def select_image_url(detail: dict[str, Any]) -> str | None:
    image = detail.get("image", {}) or {}
    url = image.get("imageUrl")
    if isinstance(url, str) and url:
        return url
    return None


def extract_core_aspects(aspects: dict[str, str]) -> dict[str, str]:
    return {key: value for key, value in aspects.items() if key in IMPORTANT_ASPECTS}


def download_and_normalize_image(
    session: requests.Session,
    url: str,
    destination: Path,
    max_side: int = 512,
) -> tuple[int, int, str]:
    response = session.get(url, timeout=30)
    response.raise_for_status()

    image = Image.open(io.BytesIO(response.content)).convert("RGB")
    image.thumbnail((max_side, max_side))
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, format="JPEG", quality=88, optimize=True)
    data = destination.read_bytes()
    return image.width, image.height, hashlib.sha1(data).hexdigest()


def build_sample_record(
    sample_id: str,
    config: CategoryConfig,
    query: str,
    detail: dict[str, Any],
    image_relative_path: str,
    image_width: int,
    image_height: int,
    image_sha1: str,
) -> dict[str, Any]:
    aspects = flatten_aspects(detail)
    core_aspects = extract_core_aspects(aspects)
    title = str(detail.get("title", "")).strip()
    category_path = str(detail.get("categoryPath", ""))
    brand = get_brand(detail, config, aspects)
    product = detail.get("product", {}) or {}
    product_title = product.get("title")
    item_name = product_title if isinstance(product_title, str) and product_title else title
    normalized_tokens = tokenize_title(item_name)
    reference_tokens = extract_reference_tokens(title)
    price_value = get_price_value(detail)
    image_url = select_image_url(detail)

    return {
        "sample_id": sample_id,
        "split": "test",
        "source": "ebay_browse_api",
        "major_category_key": config.key,
        "major_category_label_ja": config.label_ja,
        "source_query": query,
        "ebay_item_id": detail.get("itemId", ""),
        "ebay_item_web_url": detail.get("itemWebUrl", ""),
        "ebay_title": title,
        "ground_truth_item_name": item_name,
        "brand": brand or "",
        "subcategory": category_path.split("|")[-1] if category_path else "",
        "category_path": category_path,
        "condition": str(detail.get("condition", "")),
        "price_usd": round(price_value, 2),
        "image_path": image_relative_path,
        "image_url": image_url or "",
        "image_width": image_width,
        "image_height": image_height,
        "image_sha1": image_sha1,
        "normalized_title_tokens": normalized_tokens,
        "reference_tokens": reference_tokens,
        "product_title": product_title or "",
        "product_brand": product.get("brand", "") if isinstance(product.get("brand"), str) else "",
        "product_mpns": product.get("mpns", []) if isinstance(product.get("mpns"), list) else [],
        "product_gtins": product.get("gtins", []) if isinstance(product.get("gtins"), list) else [],
        "core_aspects": core_aspects,
        "label_source": "ebay_get_item_title_brand_aspects",
        "review_status": "auto_collected_unreviewed",
    }


def write_manifest(records: list[dict[str, Any]], output_dir: Path) -> None:
    jsonl_path = output_dir / "manifest.jsonl"
    csv_path = output_dir / "manifest.csv"

    with jsonl_path.open("w", encoding="utf-8") as jsonl_file:
        for record in records:
            jsonl_file.write(json.dumps(record, ensure_ascii=False) + "\n")

    csv_fieldnames = [
        "sample_id",
        "split",
        "major_category_key",
        "major_category_label_ja",
        "source_query",
        "ebay_item_id",
        "ebay_item_web_url",
        "ebay_title",
        "ground_truth_item_name",
        "brand",
        "subcategory",
        "category_path",
        "condition",
        "price_usd",
        "image_path",
        "image_url",
        "image_width",
        "image_height",
        "image_sha1",
        "label_source",
        "review_status",
    ]

    with csv_path.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=csv_fieldnames)
        writer.writeheader()
        for record in records:
            writer.writerow({key: record.get(key, "") for key in csv_fieldnames})


def write_summary(records: list[dict[str, Any]], output_dir: Path) -> None:
    counts: dict[str, int] = {}
    for record in records:
        counts[record["major_category_key"]] = counts.get(record["major_category_key"], 0) + 1

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "dataset_version": "ebay_identification_v1",
        "sample_count": len(records),
        "counts_by_category": counts,
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))


def build_dataset(force: bool) -> Path:
    env = load_env(ENV_FILE)
    if "EBAY_CLIENT_ID" not in env or "EBAY_CLIENT_SECRET" not in env:
        raise RuntimeError(".env.local に eBay 認証情報がありません。")

    if force and OUTPUT_ROOT.exists():
        shutil.rmtree(OUTPUT_ROOT)

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    token, marketplace = get_access_token(session, env)

    records: list[dict[str, Any]] = []
    seen_item_ids: set[str] = set()
    seen_title_keys: set[tuple[str, str]] = set()

    for config in CATEGORY_CONFIGS:
        category_records: list[dict[str, Any]] = []

        for query_pass in (1, 2):
            if len(category_records) >= config.target_count:
                break

            for query in config.queries:
                if len(category_records) >= config.target_count:
                    break

                picked_in_query = 0
                search_results = search_items(session, token, marketplace, query, limit=30)

                for summary in search_results:
                    if len(category_records) >= config.target_count:
                        break

                    item_id = str(summary.get("itemId", "")).strip()
                    item_href = summary.get("itemHref")
                    if not item_id or not isinstance(item_href, str):
                        continue
                    if item_id in seen_item_ids:
                        continue

                    try:
                        detail = get_item_detail(session, token, marketplace, item_href)
                    except requests.RequestException:
                        continue

                    title = str(detail.get("title", "")).strip()
                    category_path = str(detail.get("categoryPath", "")).strip()
                    if not title or not category_path:
                        continue
                    if is_banned_title(title, config):
                        continue
                    if not has_required_title_keyword(title, config):
                        continue
                    if not allow_category_path(category_path, config):
                        continue
                    if get_price_value(detail) < config.min_price_usd:
                        continue

                    title_key = (config.key, slugify(title))
                    if title_key in seen_title_keys:
                        continue

                    image_url = select_image_url(detail)
                    if not image_url:
                        continue

                    sample_id = f"{config.image_dir}-{len(category_records) + 1:03d}"
                    relative_image_path = f"images/{config.image_dir}/{sample_id}.jpg"
                    destination = OUTPUT_ROOT / relative_image_path

                    try:
                        image_width, image_height, image_sha1 = download_and_normalize_image(
                            session, image_url, destination
                        )
                    except Exception:
                        continue

                    record = build_sample_record(
                        sample_id,
                        config,
                        query,
                        detail,
                        relative_image_path,
                        image_width,
                        image_height,
                        image_sha1,
                    )

                    category_records.append(record)
                    seen_item_ids.add(item_id)
                    seen_title_keys.add(title_key)
                    picked_in_query += 1

                    if query_pass == 1 and picked_in_query >= config.max_per_query_first_pass:
                        break

        if len(category_records) < config.target_count:
            raise RuntimeError(
                f"{config.label_ja} が {config.target_count} 件に届きませんでした: {len(category_records)} 件"
            )

        records.extend(category_records)

    write_manifest(records, OUTPUT_ROOT)
    write_summary(records, OUTPUT_ROOT)
    return OUTPUT_ROOT


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="既存の出力を削除して再生成します。")
    args = parser.parse_args()

    output_dir = build_dataset(force=args.force)
    print(output_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
