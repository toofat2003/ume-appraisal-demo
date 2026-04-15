# カテゴリ判定ロジック改善 2026-04-15

## 変更内容

今回の修正では、Google Cloud Vision を入れる前に、現行パイプライン内部の判定ロジックを見直した。

- `inferCategoryGroup` の判定順を修正
- `Rings`, `Necklaces & Pendants`, `Bracelets & Charms`, `Earrings` を `jewelry` に寄せるよう修正
- `coin` 系判定を部分一致ではなく term 単位に変更
- `Tops`, `T-Shirts`, `Coats, Jackets & Vests` などを `fashion` に寄せるよう修正
- benchmark のカテゴリ変換でも `categoryGroup == coins` を優先するよう修正
- ブランド抽出ノイズを減らすため、`authentic`, `vintage`, `genuine` などを stopword に追加

## ベンチマーク比較

比較対象:

- baseline: `benchmark_runs/current_pipeline_v1/report.json`
- after fix: `benchmark_runs/current_pipeline_v3_term_matching/report.json`

| 指標 | baseline | after fix |
| --- | ---: | ---: |
| category accuracy | 73.89% | 96.67% |
| brand accuracy | 42.55% | 44.68% |
| item token F1 | 0.3594 | 0.3585 |
| reference hit rate | 40.00% | 41.82% |
| latency p50 | 1443.5ms | 1226.0ms |
| latency p90 | 1646.0ms | 1446.0ms |

カテゴリ別:

| カテゴリ | baseline | after fix |
| --- | ---: | ---: |
| ブランドバッグ | 96.67% | 96.67% |
| ジュエリー・貴金属 | 0.00% | 100.00% |
| アパレル | 96.67% | 100.00% |
| 時計 | 100.00% | 100.00% |
| 古銭 | 50.00% | 96.67% |
| 骨董・美術 | 100.00% | 86.67% |

## 解釈

今回の修正で分かったことは明確。

1. `ジュエリー 0%` の主因は Vision 不足ではなくカテゴリ判定ロジックの不備だった。
2. `古銭 50%` も半分以上はローカル判定側で改善できた。
3. `時計 / ブランドバッグ / アパレル` は現状ロジックでも十分に強い。
4. いま残っている主課題は `ブランド / 品名粒度` と `骨董 vs 古銭の境界`。

つまり、Google Cloud Vision を全面導入する前に、まずはローカルのルール設計を整えるほうが効果が大きい。

## 残件

今回の benchmark で残った誤判定は 6件。

- `antiques_art-004`: Satsuma vase が `coins`
- `antiques_art-019`: Royal Crown Derby plate が `coins`
- `antiques_art-023`: 水彩画が `other`
- `antiques_art-026`: 明治期ブロンズ花器が `other`
- `brand_bag-027`: Burberry tote が `other`
- `coins-020`: South Carolina note が `other`

残りの失敗を見ると、次にやるべきことは次の2つ。

- `antiques / art / brass / vase / plate / painting` の category group をもう少し厚くする
- `brand` と `itemName` の抽出を phrase ベースに改善する

## 判断

この時点では、Google Cloud Vision は `必須` ではない。
次の順番が妥当。

1. brand / itemName 抽出改善
2. antiques / coins 境界の追加修正
3. その後に OCR が効くカテゴリだけ Vision PoC

特に Vision を試す優先対象は変わらず:

- 古銭・紙幣
- ジュエリー刻印
- 時計の型番読取
