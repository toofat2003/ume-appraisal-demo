# eBay Identification Benchmark v1

このフォルダは、`画像 -> 品目同定` の比較用 benchmark です。

## 構成

- [manifest.jsonl](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/benchmark/ebay_identification_v1/manifest.jsonl)
- [manifest.csv](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/benchmark/ebay_identification_v1/manifest.csv)
- [summary.json](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/benchmark/ebay_identification_v1/summary.json)
- `images/<category>/<sample_id>.jpg`

## 件数

- `brand_bag`: 30
- `jewelry_precious_metals`: 30
- `apparel`: 30
- `watch`: 30
- `coins`: 30
- `antiques_art`: 30

合計: 180

## 生成方法

生成スクリプト:
- [scripts/build_ebay_identification_benchmark.py](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/scripts/build_ebay_identification_benchmark.py)

実行例:

```bash
python3 scripts/build_ebay_identification_benchmark.py --force
```

## 注意

- 画像は eBay listing 由来です
- 画像は最長辺 512px に正規化しています
- ラベルは eBay `getItem` ベースの自動収集です
- 外部再配布の可否は別途確認してください
