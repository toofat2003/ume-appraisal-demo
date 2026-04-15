#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import statistics
from pathlib import Path


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


def load_manifest(path: Path) -> dict[str, dict]:
    manifest: dict[str, dict] = {}
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        manifest[row["sample_id"]] = row
    return manifest


def load_predictions(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", help="manifest.jsonl のパス")
    parser.add_argument("predictions", help="predictions.jsonl のパス")
    args = parser.parse_args()

    manifest = load_manifest(Path(args.manifest))
    predictions = load_predictions(Path(args.predictions))

    category_hits: list[int] = []
    brand_hits: list[int] = []
    item_f1_scores: list[float] = []
    reference_hits: list[int] = []

    for prediction in predictions:
        sample_id = prediction["sample_id"]
        if sample_id not in manifest:
            continue
        truth = manifest[sample_id]

        predicted_category = prediction.get("predicted_category", "")
        predicted_brand = prediction.get("predicted_brand", "")
        predicted_item_name = prediction.get("predicted_item_name", "")
        predicted_reference_tokens = [normalize(token) for token in prediction.get("predicted_reference_tokens", [])]

        category_hits.append(int(normalize(predicted_category) == normalize(truth["major_category_key"])))

        if truth.get("brand"):
            brand_hits.append(int(normalize(predicted_brand) == normalize(truth["brand"])))

        item_f1_scores.append(token_f1(predicted_item_name, truth["ground_truth_item_name"]))

        truth_reference_tokens = [normalize(token) for token in truth.get("reference_tokens", [])]
        if truth_reference_tokens:
            reference_hits.append(int(any(token in predicted_reference_tokens for token in truth_reference_tokens)))

    report = {
        "sample_count_scored": len(item_f1_scores),
        "category_accuracy": round(sum(category_hits) / len(category_hits), 4) if category_hits else None,
        "brand_accuracy_labeled_only": round(sum(brand_hits) / len(brand_hits), 4) if brand_hits else None,
        "item_name_token_f1_macro": round(statistics.mean(item_f1_scores), 4) if item_f1_scores else None,
        "item_name_token_f1_median": round(statistics.median(item_f1_scores), 4) if item_f1_scores else None,
        "reference_hit_rate_labeled_only": round(sum(reference_hits) / len(reference_hits), 4)
        if reference_hits
        else None,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
