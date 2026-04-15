# 査定パイプライン診断メモ

更新日: 2026-04-13

## 結論

現状の主因は `1. 写真から品名を特定する段階` です。  
`2. 品名からeBay上の出品を探す段階` にもノイズはありますが、良い検索語さえ入れば概ね成立します。

今回の時計ケースでは、問題は次のように切り分けられました。

1. 1枚目の文字盤画像は使える  
   ローカルOCRでも `ROLEX / OYSTER PERPETUAL / Air-King / PRECISION` が読めました。
2. 2枚目の裏蓋・ブレス画像は半分壊れる  
   `Rolex Air-King 114210 ...` は拾える一方で、`watch band` が大量に混ざります。
3. 3枚目の金属クローズアップは完全にノイズ源  
   hubcap、mirror、Harley部品など、時計と無関係な結果が返りました。
4. 正しい品名で eBay テキスト検索すると、腕時計本体はかなり拾える  
   ただし dial や band などの部品系は混ざるので、カテゴリ・付属品フィルタは引き続き必要です。

## 実測結果

再現スクリプト:
- [scripts/diagnose_ebay_pipeline.py](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/scripts/diagnose_ebay_pipeline.py)
- [scripts/vision_ocr.swift](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/scripts/vision_ocr.swift)

生レポート:
- [docs/diagnosis_report_2026-04-13.json](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/docs/diagnosis_report_2026-04-13.json)

ローカル時計画像:
- 1枚目 [S__35241987_0.jpg](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/test_pictures/watch/S__35241987_0.jpg)
  `searchByImage` 上位は Air-King 系の腕時計で安定。OCRもブランド名とモデル名を拾えた。
- 2枚目 [S__35241988_0.jpg](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/test_pictures/watch/S__35241988_0.jpg)
  上位1件は正しいが、その後に band が連続する。画像検索だけで価格計算すると壊れやすい。
- 3枚目 [S__35241989_0.jpg](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/test_pictures/watch/S__35241989_0.jpg)
  時計カテゴリ自体に乗らず、無関係な金属製品へ飛ぶ。品名特定用途には不適。

正解検索語の検証:
- `Rolex Air-King 114210 34mm` で eBay テキスト検索すると、腕時計本体は拾える。
- 一方で dial などの部品も混ざるため、`品名検索は使えるが、そのまま価格計算に使うのは危険` という結果。

ネット上のコントロール画像:
- eBay listing 画像を種にした `searchByImage` では、`Coach Tabby 26` はかなり正確。
- `iPhone 13 Pro 128GB` は `13 Pro Max` が上位に出るなど近縁機種ズレはあるが、カテゴリはスマホに収まる。
- `Rolex Air King 14000` は同じ腕時計カテゴリには乗るが、近縁モデルに広がる。

要するに、`eBayの画像検索は listing 風の画像には強いが、訪問買取の現場写真、とくに裏面・細部・ダメージ写真には弱い` です。

## 実施した改善

アプリ実装:
- [lib/appraisal/ebay.ts](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/lib/appraisal/ebay.ts)
- [app/api/appraisal/route.ts](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/app/api/appraisal/route.ts)
- [app/page.tsx](/Users/kosukenakajima/Desktop/buysell_technologies/ume-appraisal-demo/app/page.tsx)

変更内容:

1. `画像検索ステージ` と `品名検索ステージ` を分離
   まず各画像を `searchByImage` にかけ、最も一貫した1枚だけを商品特定に使うように変更。

2. 3枚を直列処理していた部分を並列化
   旧実装は画像ごとに順番に API 往復していたため、3枚で待ち時間が累積していた。
   新実装は並列実行なので、体感待ち時間がかなり下がる。

3. 価格参照は `eBayテキスト検索` を優先
   画像検索で作った検索語を使って別途 `search` を叩き、カテゴリと付属品フィルタを通した listing を価格計算に使うように変更。

4. デバッグ情報を API と画面に追加
   どの画像が採用されたか、各画像の件数、品名検索の件数が見えるようにした。

今回の時計画像3枚では、新パイプラインで次の状態まで確認済みです。

- 採用画像: 1枚目
- 品名: `Rolex Air King`
- 検索語: `Rolex Air King 14000`
- 品名検索の採用件数: 19件
- 画像検索だけでなく、品名検索へ切り替わっていることを確認済み

## 次にやるべき改善

優先順はこうです。

1. `画像1 = 全体写真` をさらに強く扱う
   現場入力上は1枚目が全体写真の前提なので、1枚目のスコアをさらに優遇してよい。

2. 画像解析を eBay 以外に分ける
   eBay `searchByImage` は価格ソース兼検索ソースとしては有用だが、品名特定器としては不安定。
   次の候補は `OCR + Web照合` 系。

3. 正式な代替候補
   `Google Cloud Vision OCR` は画像内テキスト抽出に向いている。
   `Google Cloud Vision Web Detection` は web entities、full matching images、pages with matching images を返せる。
   これらは `画像 -> 品名候補` の段階に向いていて、`価格取得` は引き続き eBay でよい。

4. 型番優先のルールを足す
   OCR で `114210` のような型番が読めた場合は、その数字を検索語に強制で入れるべき。
   いまの改善ではまだ画像検索由来の `14000` が採用されるケースがある。

## 調査ソース

- eBay `searchByImage` は `Base64 image` を受け取り、カテゴリや filter で絞れる。Sandbox 非対応。  
  [searchByImage: eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/searchByImage)
- eBay `search` は `q` でキーワード検索する。  
  [search: eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/resources/item_summary/methods/search)
- Google Cloud Vision OCR は `TEXT_DETECTION` / `DOCUMENT_TEXT_DETECTION` を提供する。  
  [Detect and extract text from images](https://docs.cloud.google.com/vision/docs/ocr)
- Google Cloud Vision Web Detection は `Web entities`、`Full matching images`、`Pages with matching images` を返せる。  
  [Detect Web entities and pages](https://docs.cloud.google.com/vision/docs/detecting-web)
