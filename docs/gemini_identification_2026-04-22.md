# Gemini 3 画像同定への置き換えメモ

## 結論

今回のブランドバッグ8件ベンチでは、Gemini 3の画像入力がGoogle Cloud Vision Web DetectionとeBay searchByImageを上回った。

Google Lens/Google画像検索そのものをサーバーサイドから同等APIとして呼び出す公式APIは確認できない。Cloud Vision Web DetectionはWeb上の類似画像・Web entity・類似ページを返すAPIで、Lensそのものではない。今回の用途では、画像を直接読ませて品名候補をJSONで生成できるGemini 3のほうが近い。

## 実装方針

- `APPRAISAL_IMAGE_PROVIDER=gemini` でGemini 3を主経路にする。
- `GEMINI_MODEL` のデフォルトは `gemini-3-pro-preview`。
- Geminiは画像から `itemName`、`brand`、`model`、`category`、eBay向け検索語候補を返す。
- 価格そのものはGeminiに推定させず、検索語をeBay Browse text searchへ渡して出品価格から算出する。
- 2枚目/3枚目がある場合は、`1枚目のみ` と `全画像` のGemini同定を比較し、全画像側が明確に良い時だけ採用する。

## ベンチ結果

対象データセット: `datasets/price_pair_benchmark_2026-04-22/dataset.json`

| Provider | Input | Median within ±30% | Include rows only | Reference within IQR | Mean abs median error |
| --- | --- | ---: | ---: | ---: | ---: |
| Google Vision | Product only | 1/8 | 1/5 | 1/8 | 72.0% |
| Google Vision | Product + price tag | 3/8 | 2/5 | 3/8 | 59.1% |
| eBay searchByImage | Product only | 2/8 | 2/5 | 2/8 | 44.5% |
| Gemini 3 | Product only | 5/8 | 4/5 | 4/8 | 32.4% |
| Gemini 3 | Product + price tag, selected | 5/8 | 4/5 | 5/8 | 30.8% |

## 残課題

- 複数商品が同じ写真に写るケースでは、Gemini 3でも対象商品の切り分けに失敗することがある。
- eBay側の検索結果に安い類似品や広すぎるカテゴリが混ざると、商品名が正しくても中央値が下振れする。
- 速度はGemini呼び出しとeBay検索の両方に依存する。2枚目以降がある場合はGeminiを2回呼ぶため、精度優先のPOC向け設定。

## 参照

- Gemini API models: https://ai.google.dev/gemini-api/docs/models
- Gemini API changelog: https://ai.google.dev/gemini-api/docs/changelog
- Cloud Vision Web Detection: https://cloud.google.com/vision/docs/detecting-web
- Vision API requests: https://cloud.google.com/vision/docs/request
