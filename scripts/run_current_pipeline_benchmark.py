#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests


STOPWORDS = {
    "a",
    "an",
    "and",
    "bag",
    "good",
    "new",
    "of",
    "pre",
    "owned",
    "the",
    "used",
    "watch",
    "with",
}


def normalize(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def tokenize(value: str) -> list[str]:
    return [token for token in normalize(value).split() if token and token not in STOPWORDS]


def token_f1(predicted: str, ground_truth: str) -> float:
    pred_tokens = set(tokenize(predicted))
    truth_tokens = set(tokenize(ground_truth))
    if not pred_tokens and not truth_tokens:
        return 1.0
    if not pred_tokens or not truth_tokens:
        return 0.0
    overlap = len(pred_tokens & truth_tokens)
    precision = overlap / len(pred_tokens)
    recall = overlap / len(truth_tokens)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def extract_reference_tokens(*values: str) -> list[str]:
    patterns = [
        re.compile(r"\b[a-z]{0,3}\d{3,8}[a-z]{0,3}\b", re.IGNORECASE),
        re.compile(r"\b\d{2,4}mm\b", re.IGNORECASE),
        re.compile(r"\b\d{2,4}[a-z]?\b", re.IGNORECASE),
    ]
    output: list[str] = []
    for value in values:
        for pattern in patterns:
            for match in pattern.findall(value or ""):
                normalized = normalize(match)
                if normalized and normalized not in output:
                    output.append(normalized)
    return output


def load_manifest(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def map_prediction_category(payload: dict[str, Any]) -> str:
    identification = payload.get("identification", {}) or {}
    category_group = normalize(str(identification.get("categoryGroup", "")))
    category = normalize(str(identification.get("category", "")))
    item_name = normalize(str(identification.get("itemName", "")))
    search_query = normalize(str(identification.get("searchQuery", "")))
    combined = " ".join([category_group, category, item_name, search_query]).strip()

    if category_group == "watch" or "wristwatch" in combined or "watch" in combined:
        return "watch"

    if category_group == "coins":
        return "coins"

    if category_group == "jewelry":
        return "jewelry_precious_metals"

    if any(keyword in combined for keyword in ["coin", "currency", "banknote", "note", "dollar", "cent", "nickel", "dime", "quarter"]):
        return "coins"

    if any(keyword in combined for keyword in ["ring", "necklace", "bracelet", "earring", "pearl", "diamond", "gold", "silver"]):
        return "jewelry_precious_metals"

    if any(keyword in combined for keyword in ["vase", "painting", "print", "sculpture", "art", "antique", "bronze", "pottery", "woodblock", "plate", "figurine"]):
        return "antiques_art"

    if category_group == "fashion":
        if any(keyword in combined for keyword in ["bag", "handbag", "satchel", "crossbody", "shoulder bag", "tote", "purse", "wallet"]):
            return "brand_bag"
        return "apparel"

    if any(keyword in combined for keyword in ["bag", "handbag", "satchel", "crossbody", "tote", "purse", "wallet"]):
        return "brand_bag"

    if any(keyword in combined for keyword in ["coat", "jacket", "shirt", "hoodie", "dress", "pants", "trench", "fleece", "sweater", "tee"]):
        return "apparel"

    if category_group == "collectible":
        return "antiques_art"

    return "other"


def run_sample(base_url: str, root: Path, row: dict[str, Any], timeout: int) -> dict[str, Any]:
    image_path = root / row["image_path"]
    started_at = time.time()
    with image_path.open("rb") as image_file:
        response = requests.post(
            f"{base_url.rstrip('/')}/api/appraisal",
            files={"images": (image_path.name, image_file, "image/jpeg")},
            timeout=timeout,
        )
    latency_ms = int((time.time() - started_at) * 1000)

    raw: dict[str, Any]
    try:
        raw = response.json()
    except Exception:
        raw = {"error": response.text[:500]}

    identification = raw.get("identification", {}) if isinstance(raw, dict) else {}
    predicted_item_name = str(identification.get("itemName", "")) if isinstance(identification, dict) else ""
    predicted_brand = str(identification.get("brand", "")) if isinstance(identification, dict) else ""
    predicted_category = map_prediction_category(raw if isinstance(raw, dict) else {})
    predicted_reference_tokens = extract_reference_tokens(
        predicted_item_name,
        str(identification.get("searchQuery", "")) if isinstance(identification, dict) else "",
    )

    return {
        "sample_id": row["sample_id"],
        "truth_category": row["major_category_key"],
        "truth_brand": row.get("brand", ""),
        "truth_item_name": row["ground_truth_item_name"],
        "http_status": response.status_code,
        "latency_ms": latency_ms,
        "success": response.ok,
        "predicted_category": predicted_category,
        "predicted_brand": predicted_brand,
        "predicted_item_name": predicted_item_name,
        "predicted_reference_tokens": predicted_reference_tokens,
        "raw_response": raw,
    }


def build_report(results: list[dict[str, Any]]) -> dict[str, Any]:
    successful = [result for result in results if result["success"]]
    latencies = [result["latency_ms"] for result in successful]

    category_hits: list[int] = []
    brand_hits: list[int] = []
    item_f1_scores: list[float] = []
    reference_hits: list[int] = []
    per_category: dict[str, dict[str, list[float] | int]] = defaultdict(
        lambda: {"total": 0, "success": 0, "category_hits": [], "item_f1_scores": [], "brand_hits": [], "reference_hits": []}
    )

    for result in results:
        truth_category = result["truth_category"]
        bucket = per_category[truth_category]
        bucket["total"] += 1

        if not result["success"]:
            continue

        bucket["success"] += 1
        category_hit = int(normalize(result["predicted_category"]) == normalize(truth_category))
        category_hits.append(category_hit)
        bucket["category_hits"].append(category_hit)

        item_f1 = token_f1(result["predicted_item_name"], result["truth_item_name"])
        item_f1_scores.append(item_f1)
        bucket["item_f1_scores"].append(item_f1)

        if result["truth_brand"]:
            brand_hit = int(normalize(result["predicted_brand"]) == normalize(result["truth_brand"]))
            brand_hits.append(brand_hit)
            bucket["brand_hits"].append(brand_hit)

        truth_reference_tokens = extract_reference_tokens(result["truth_item_name"])
        if truth_reference_tokens:
            reference_hit = int(
                any(token in result["predicted_reference_tokens"] for token in truth_reference_tokens)
            )
            reference_hits.append(reference_hit)
            bucket["reference_hits"].append(reference_hit)

    confusion = Counter(
        (result["truth_category"], result["predicted_category"]) for result in successful
    )

    report = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sample_count_total": len(results),
        "sample_count_success": len(successful),
        "sample_count_error": len(results) - len(successful),
        "success_rate": round(len(successful) / len(results), 4) if results else None,
        "category_accuracy": round(sum(category_hits) / len(category_hits), 4) if category_hits else None,
        "brand_accuracy_labeled_only": round(sum(brand_hits) / len(brand_hits), 4) if brand_hits else None,
        "item_name_token_f1_macro": round(statistics.mean(item_f1_scores), 4) if item_f1_scores else None,
        "item_name_token_f1_median": round(statistics.median(item_f1_scores), 4) if item_f1_scores else None,
        "reference_hit_rate_labeled_only": round(sum(reference_hits) / len(reference_hits), 4)
        if reference_hits
        else None,
        "latency_ms_p50": round(statistics.median(latencies), 1) if latencies else None,
        "latency_ms_p90": round(sorted(latencies)[int(len(latencies) * 0.9) - 1], 1) if latencies else None,
        "latency_ms_mean": round(statistics.mean(latencies), 1) if latencies else None,
        "per_category": {},
        "confusion_top": [
            {"truth": truth, "predicted": predicted, "count": count}
            for (truth, predicted), count in confusion.most_common(20)
        ],
    }

    for category, bucket in per_category.items():
        report["per_category"][category] = {
            "total": bucket["total"],
            "success": bucket["success"],
            "success_rate": round(bucket["success"] / bucket["total"], 4) if bucket["total"] else None,
            "category_accuracy": round(sum(bucket["category_hits"]) / len(bucket["category_hits"]), 4)
            if bucket["category_hits"]
            else None,
            "item_name_token_f1_macro": round(statistics.mean(bucket["item_f1_scores"]), 4)
            if bucket["item_f1_scores"]
            else None,
            "brand_accuracy_labeled_only": round(sum(bucket["brand_hits"]) / len(bucket["brand_hits"]), 4)
            if bucket["brand_hits"]
            else None,
            "reference_hit_rate_labeled_only": round(
                sum(bucket["reference_hits"]) / len(bucket["reference_hits"])
            )
            if bucket["reference_hits"]
            else None,
        }

    return report


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:3001", help="査定APIのベースURL")
    parser.add_argument(
        "--manifest",
        default=str(Path("benchmark/ebay_identification_v1/manifest.jsonl")),
        help="manifest.jsonl のパス",
    )
    parser.add_argument(
        "--output-dir",
        default=str(Path("benchmark_runs/current_pipeline_v1")),
        help="出力ディレクトリ",
    )
    parser.add_argument("--concurrency", type=int, default=4, help="同時実行数")
    parser.add_argument("--timeout", type=int, default=120, help="1サンプルあたりのタイムアウト秒")
    args = parser.parse_args()

    manifest_path = Path(args.manifest)
    manifest_rows = load_manifest(manifest_path)
    dataset_root = manifest_path.parent
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        future_map = {
            executor.submit(run_sample, args.base_url, dataset_root, row, args.timeout): row["sample_id"]
            for row in manifest_rows
        }
        for future in as_completed(future_map):
            results.append(future.result())

    results.sort(key=lambda row: row["sample_id"])
    predictions = [
        {
            "sample_id": row["sample_id"],
            "predicted_category": row["predicted_category"],
            "predicted_brand": row["predicted_brand"],
            "predicted_item_name": row["predicted_item_name"],
            "predicted_reference_tokens": row["predicted_reference_tokens"],
        }
        for row in results
    ]

    report = build_report(results)

    write_jsonl(output_dir / "raw_results.jsonl", results)
    write_jsonl(output_dir / "predictions.jsonl", predictions)
    (output_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(output_dir)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
