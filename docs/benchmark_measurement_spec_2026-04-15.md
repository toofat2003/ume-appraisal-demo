# 品目同定ベンチマーク仕様

更新日: 2026-04-15

## 目的

このベンチマークは、`商品の写真から品目をどこまで同定できるか` を定量的に比較するためのものです。

主に比較したいのは次の2段階です。

1. `画像 -> 品目候補生成`
2. `品目候補 -> eBay上の価格検索`

今回作成したデータセットは、まず `1. 画像 -> 品目候補生成` の比較基盤として使います。

## データセット

配置先:
- [benchmark/ebay_identification_v1](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/benchmark/ebay_identification_v1)

内容:
- 6カテゴリ x 30件 = 180件
- 画像は eBay listing の primary image を取得し、最長辺 512px に正規化
- manifest は JSONL と CSV の両方を出力

カテゴリ:
- `brand_bag`
- `jewelry_precious_metals`
- `apparel`
- `watch`
- `coins`
- `antiques_art`

重要な注意:
- これは `eBay listing 画像ベース` の benchmark です。現場の雑多なスマホ写真 benchmark ではありません。
- したがって、ここで高精度でも訪問買取の現場写真にそのまま外挿はできません。
- ただし `品目同定器そのものの上限感` を見る一次 benchmark としては有効です。

## ラベル仕様

1件の正解データには主に次の情報があります。

- `major_category_key`
  6大カテゴリの正解
- `ground_truth_item_name`
  正解品目名。eBay `getItem` の product title があればそれを優先し、なければ listing title を使う
- `brand`
  eBay detail の brand / product.brand / aspects から取得
- `subcategory`
  eBay category path の末尾
- `reference_tokens`
  型番・品番らしき token を title から抽出
- `core_aspects`
  `Type`, `Material`, `Year`, `Denomination` など比較に使いやすい属性だけ抽出

ラベルは `auto_collected_unreviewed` です。  
つまり `完全な人手GT` ではなく、eBay detail ベースの自動GTです。  
正式運用前には、各カテゴリ5-10件だけでも spot review したほうがよいです。

## 推奨評価指標

最初は次の4本で十分です。

1. `category_accuracy`
   6カテゴリを当てられたか

2. `brand_accuracy_labeled_only`
   brand が付いているサンプルだけで、ブランド一致を見る

3. `item_name_token_f1_macro`
   品目名の token overlap で評価する
   完全一致ではなく token F1 にする理由は、listing title の揺れが大きいため

4. `reference_hit_rate_labeled_only`
   型番や年号などの `reference_tokens` を prediction が拾えたか

## なぜ exact match ではなく token F1 か

例えば次の2つは実務上かなり近いです。

- `Rolex Air King Precision Stainless Steel 34mm`
- `Rolex Air-King 34mm Precision Watch`

しかし exact match だと不一致になります。  
そのため、ベンチマークでは以下を優先します。

- まず大カテゴリが合っているか
- 次にブランドが合っているか
- 最後に item name の重要 token がどれだけ合っているか

## 予測ファイル形式

評価スクリプトは JSONL を受けます。各行の最小フォーマットは次です。

```json
{"sample_id":"watch-001","predicted_category":"watch","predicted_brand":"Rolex","predicted_item_name":"Rolex Air King 5500","predicted_reference_tokens":["5500"]}
```

## 評価スクリプト

スクリプト:
- [scripts/evaluate_identification_benchmark.py](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/scripts/evaluate_identification_benchmark.py)

実行例:

```bash
python3 scripts/evaluate_identification_benchmark.py \
  benchmark/ebay_identification_v1/manifest.jsonl \
  predictions.jsonl
```

返る値:
- `category_accuracy`
- `brand_accuracy_labeled_only`
- `item_name_token_f1_macro`
- `item_name_token_f1_median`
- `reference_hit_rate_labeled_only`

## 収集方法

今回のデータセットは eBay Browse API を使って作成しています。

- listing 候補取得: `search`
- 詳細取得: `getItem`

公式:
- [eBay Browse API search](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)
- [eBay Browse API getItem](https://developer.ebay.com/api-docs/buy/browse/resources/item/methods/getItem)

## 今後の拡張

次にやる価値が高いのはこれです。

1. `field-photo benchmark` を別で作る
   eBay listing 画像ではなく、実際の訪問買取写真を GT 付きで少量作る

2. `multi-image benchmark` を作る
   今回は1 item = 1 image だが、実運用は複数枚なので、`全体 / ラベル / ダメージ` の3枚セット評価に拡張する

3. `hard subset` を作る
   似た見た目の型違い、付属品混入、古銭の摩耗個体だけを抜き出して難問セット化する
