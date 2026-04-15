# 現行パイプラインのベンチマーク結果と Google Cloud Vision 導入判断

更新日: 2026-04-15

## 1. 目的

現行の査定モックをそのままベンチマークに通し、改善前の基準値を確定する。
そのうえで、Google Cloud Vision API を今すぐ導入すべきか、どの範囲で試すべきかを判断する。

評価対象:

- 実装: `app/api/appraisal/route.ts` + `lib/appraisal/ebay.ts`
- データセット: `benchmark/ebay_identification_v1`
- 評価仕様: `docs/benchmark_measurement_spec_2026-04-15.md`

## 2. 実行条件

- 実行日時: 2026-04-15
- 対象件数: 180件
- 内訳: 6カテゴリ x 各30件
- 呼び出し先: `http://127.0.0.1:3001/api/appraisal`
- 実行スクリプト: `scripts/run_current_pipeline_benchmark.py`
- 生ログ: `benchmark_runs/current_pipeline_v1/raw_results.jsonl`
- 集計結果: `benchmark_runs/current_pipeline_v1/report.json`

## 3. 全体結果

| 指標 | 値 |
| --- | ---: |
| サンプル総数 | 180 |
| 成功件数 | 180 |
| エラー件数 | 0 |
| 成功率 | 100.0% |
| カテゴリ正解率 | 73.89% |
| ブランド正解率 `labeled only` | 42.55% |
| 品名 token F1 `macro` | 0.3594 |
| 品名 token F1 `median` | 0.3750 |
| reference hit rate `labeled only` | 40.0% |
| レイテンシ p50 | 1443.5ms |
| レイテンシ p90 | 1646.0ms |
| レイテンシ mean | 1454.9ms |

結論として、`落ちずに返す` ことはできているが、`品目同定の精度` はまだ benchmark として弱い。
特にカテゴリ正解率 73.89%、品名 token F1 0.3594 は、価格ロジック改善の比較土台としてはギリギリで、まず同定精度の改善余地が大きい。

## 4. カテゴリ別結果

| カテゴリ | category acc | brand acc | item token F1 |
| --- | ---: | ---: | ---: |
| ブランドバッグ | 96.67% | 80.00% | 0.4273 |
| ジュエリー・貴金属 | 0.00% | 6.67% | 0.3586 |
| アパレル | 96.67% | 26.67% | 0.3802 |
| 時計 | 100.00% | 83.33% | 0.4246 |
| 古銭 | 50.00% | 14.29% | 0.2519 |
| 骨董・美術 | 100.00% | 0.00% | 0.3137 |

所見:

- `時計` と `ブランドバッグ` は現状でもかなり強い。
- `アパレル` はカテゴリ判定は通るが、品名とブランドの粒度が弱い。
- `ジュエリー・貴金属` は壊滅しているが、後述のとおり純粋な画像認識限界というよりロジック不備の影響が大きい。
- `古銭` は本質的に難しく、画像検索先のカテゴリ品質も悪い。
- `骨董・美術` は粗いカテゴリ分類は通るが、品名精度は低い。

## 5. 失敗原因の切り分け

### 5.1 ジュエリーは「画像認識失敗」ではなく「カテゴリ付与ロジックの不備」が主因

ベンチマーク上では、ジュエリー30件がすべて `watch` 扱いになった。
ただし raw log を見ると、eBay から返っているカテゴリ自体は `Rings`、`Necklaces & Pendants`、`Bracelets & Charms` などで大きく外していない。

例:

- `jewelry_precious_metals-002`
  - truth: `Cartier Love Ring Band Small Model`
  - predicted item: `Cartier Love Ring`
  - eBay category: `Rings`
  - categoryGroup: `watch`
- `jewelry_precious_metals-004`
  - truth: `Authentic Tiffany & Co Necklace`
  - predicted item: `Tiffany Double Heart`
  - eBay category: `Necklaces & Pendants`
  - categoryGroup: `watch`

つまり、`写真 -> 品名候補` は一定程度当たっているが、`eBay category -> 内部カテゴリ群` への変換で壊している。

実装上も、`lib/appraisal/ebay.ts` の `inferCategoryGroup` は `watch` と `jewelry` を単純な文字列包含で判定しており、`Rings` や `Necklaces & Pendants` を jewelry に寄せる分岐が存在しない。

このため、ジュエリーの 0% は「Google Cloud Vision を入れないと認識できない」という証拠にはならない。

### 5.2 古銭は「画像検索先の質」と「同定難易度」の両方が問題

古銭は 30件中 15件しか正しく `coins` に入らず、13件が `antiques_art`、2件が `watch` になった。

代表例:

- `coins-003`
  - truth: `Roman coin`
  - predicted item: `Spanish Pirate Cob`
  - eBay category: `Other Historical Memorabilia`
  - predicted category: `antiques_art`
- `coins-012`
  - truth: `1875-CC Seated Liberty Dime`
  - predicted item: `Celebrate 1875 Usa`
  - eBay category: `Necklaces & Pendants`
  - predicted category: `watch`

古銭は次の理由で難しい。

- 刻印が小さい
- 類似意匠が多い
- seller 側カテゴリ品質が荒い
- eBay 上でコイン本体以外の記念グッズやアクセサリも混ざる

ここはローカルのカテゴリマッピング修正だけでは足りず、OCR や別検索ソースの補助が効く可能性が高い。

### 5.3 速度は許容だが、Vision を足すとそのままでは悪化する

現行の API レイテンシは p50 で約 1.44 秒、p90 で約 1.65 秒。
カテゴリ別でも大きくは外れていない。

ただし Google Cloud Vision を各画像ごとに追加で同期呼び出しすると、現行フローの前段に API hop が 1 回増える。
したがって、`全カテゴリ・全画像で常時 Vision` は精度改善の前に速度悪化を招きやすい。

## 6. Google Cloud Vision API で補える点

公式ドキュメント上、Vision で今回効きそうなのは主に `OCR` と `Web Detection`。

### OCR

- `TEXT_DETECTION` は画像内の文字列を抽出する
- `DOCUMENT_TEXT_DETECTION` は密な文字情報向け
- ローカル画像を base64 で直接送れる

今回の用途で効く可能性が高い対象:

- 時計: 文字盤、裏蓋、型番、リファレンス
- バッグ: ロゴ、型番タグ、シリアル近辺
- ジュエリー: 刻印 `18K`, `750`, `925`, ブランド刻印
- 古紙幣: 額面、発行体、年号

### Web Detection

- Web entities
- Pages with matching images
- Full matching images
- Visually similar images
- Best guess labels

この機能は `画像から Web 上の参照先を探す` 性質なので、`商品名候補の生成` には効く可能性がある。
ただし eBay 価格参照の代替ではなく、あくまで `画像 -> 品名候補` の補助。

## 7. Google Cloud Vision の料金感

Google 公式 pricing では次のとおり。

- `Text Detection`: 最初の 1,000 unit / month は無料、その後は 1,000 unit あたり `$1.50`
- `Web Detection`: 最初の 1,000 unit / month は無料、その後は 1,000 unit あたり `$3.50`

単純試算:

- 1商品3枚で OCR のみ
  - 10,000 商品 / 月 => 30,000 OCR request
  - おおよそ `(30,000 - 1,000) / 1,000 x $1.50 ≒ $43.50 / 月`
- 1商品3枚で OCR + Web Detection
  - OCR: 約 `$43.50 / 月`
  - Web Detection: `(30,000 - 1,000) / 1,000 x $3.50 ≒ $101.50 / 月`
  - 合計: 約 `$145 / 月`

これは API 料金だけで、GCP の運用コストや観測・再試行は含まない。

## 8. 導入判断

### 結論

`Google Cloud Vision を全面導入するのはまだ早い。`

ただし、`限定導入の PoC はやる価値が高い。`

### 理由

1. いま一番大きい穴の一つである `ジュエリー 0%` は、Vision 以前にローカルのカテゴリ変換ロジック不備が主因。
2. `時計` と `ブランドバッグ` は、現状でもカテゴリ精度が高い。
3. Vision を全件常時呼ぶと、コスト増より先に速度悪化が起きる可能性が高い。
4. それでも `古銭` と `ジュエリー刻印` は OCR / Web Detection の効きどころが明確。

### 推奨方針

#### まずやるべきこと

- `inferCategoryGroup` を修正して、`Rings`, `Necklaces & Pendants`, `Bracelets & Charms` を jewelry に寄せる
- `collectible` のうち `coin`, `currency`, `banknote`, `note`, `dollar`, `yen` などを coins に寄せる
- その状態でベンチマークを再実行する

#### その次にやるべきこと

Vision は `全件必須` ではなく、下記の条件付きで呼ぶ。

- 第1段階で品名 confidence が低い
- 古銭・紙幣カテゴリ候補に入った
- ジュエリーで刻印読取が必要
- 時計で文字盤や裏蓋の型番候補を取りたい

#### PoC の最小構成

- Stage 1: 現行の eBay image / text ベース
- Stage 2: 低 confidence 時だけ Vision OCR
- Stage 3: それでも弱い時だけ Vision Web Detection
- Stage 4: 生成されたキーワードで eBay text search を再試行

この構成なら、速度悪化とコスト増を限定しつつ、Vision の寄与だけ測定できる。

## 9. 実務判断

現時点の判断としては、こう整理するのが妥当。

- `今すぐ全面導入`: 非推奨
- `局所 PoC`: 推奨
- `導入優先カテゴリ`: 古銭、ジュエリー、時計の型番読取
- `後回しカテゴリ`: ブランドバッグ、アパレル

つまり、Google Cloud Vision は `現行パイプラインの穴を埋める補助API` としては有望だが、`まず壊れているロジックを直す前提` で評価すべき。

## 10. 参照

- Cloud Vision API overview: https://docs.cloud.google.com/vision/docs
- OCR: https://docs.cloud.google.com/vision/docs/ocr
- Web Detection: https://docs.cloud.google.com/vision/docs/detecting-web
- Pricing: https://cloud.google.com/vision/pricing
