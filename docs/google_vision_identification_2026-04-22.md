# Google Vision による画像同定への置き換え調査

## 結論

Google Lens そのものをサーバーサイドから呼び出す公式公開 API は確認できませんでした。公式 Google API で今回の用途に最も近いのは、Cloud Vision API の `WEB_DETECTION` です。

今回の構成では、eBay `searchByImage` を品名推定器として使うのをやめ、下記の流れにします。

1. アップロード画像を Cloud Vision API `images:annotate` に送る
2. `WEB_DETECTION` の `bestGuessLabels` / `webEntities` / matching page title から品名候補を作る
3. 補助的に `TEXT_DETECTION` でロゴ・型番・刻印を拾い、`LOGO_DETECTION` でブランド候補を拾う
4. 上位候補を eBay Browse `search` に投げ、価格参照用の出品を取る
5. Google Vision が未設定、または `auto` モードで価格参照が取れない場合は既存の eBay `searchByImage` にフォールバックする

## API の選定

### 採用候補: Cloud Vision API Web Detection

Cloud Vision の Web Detection は、ローカル画像を base64 にして `POST https://vision.googleapis.com/v1/images:annotate` に送ることで、Web上の類似画像・Web entity・best guess label を返します。公式サンプルでも `WEB_DETECTION` のレスポンスとして `Web entities` と `Best guess labels` が扱われています。

このため、「写真から商品名候補を作る」用途では、公式 Google API の中で最も Google Lens に近い選択肢です。

Cloud Vision の REST request は API key または OAuth token で認証できます。今回の POC では実装を軽くするため、サーバー側環境変数に保存した API key を使います。

### 不採用: Vision API Product Search

Product Search は、事業者が自分で product set と reference image を登録し、その自前カタログの中から似た商品を検索する機能です。Google 公式ドキュメント上も、retailer が商品と参照画像を product set に追加し、クエリ画像をその retailer の product set と比較する機能として説明されています。

今回必要なのは「Web上の既存情報から未知商品の候補名を出す」ことなので、Product Search は主役にはしません。将来的に自社の買取履歴画像と正解商品名が十分に貯まった段階では、再検討対象になります。

## API キー取得手順

1. Google Cloud Console でプロジェクトを作成または選択する
2. 対象プロジェクトで課金を有効化する
3. `APIs & Services` から `Cloud Vision API` を有効化する
4. `APIs & Services` > `Credentials` を開く
5. `Create credentials` > `API key` を選ぶ
6. 作成された API key を開き、API restrictions で `Cloud Vision API` のみに制限する
7. Vercel の環境変数に `GOOGLE_CLOUD_VISION_API_KEY` として設定する
8. まずは `APPRAISAL_IMAGE_PROVIDER=auto` で運用する
9. Google Vision のみの精度を測りたい時は `APPRAISAL_IMAGE_PROVIDER=google-vision` にする
10. 既存 eBay 画像検索に戻したい時は `APPRAISAL_IMAGE_PROVIDER=ebay-image` にする

API key はブラウザに出さず、Next.js のサーバー側 API route からのみ使います。

## 費用見積もり

Cloud Vision は、画像ごと・feature ごとに課金されます。公式料金ページでは、最初の 1,000 units/月は無料、1,001 から 5,000,000 units/月の価格は下記です。

| Feature | 1,001 - 5,000,000 units/月 |
| --- | ---: |
| Web Detection | $3.50 / 1,000 units |
| Text Detection | $1.50 / 1,000 units |
| Logo Detection | $1.50 / 1,000 units |

現実装は 1画像につき `WEB_DETECTION`、`TEXT_DETECTION`、`LOGO_DETECTION` を各1回使うため、1画像あたり3 unitsです。3枚アップロードなら1査定あたり9 unitsです。

概算:

| 査定数/月 | 画像枚数/査定 | 月間 units | 無料枠後の概算 |
| ---: | ---: | ---: | ---: |
| 100 | 3 | 900 | $0 |
| 500 | 3 | 4,500 | 約 $16 |
| 1,000 | 3 | 9,000 | 約 $43 |

計算は、無料枠 1,000 units を超えた分について、Web/Text/Logo の組み合わせ単価を概算したものです。実際の請求は Google Cloud の SKU と利用 feature 単位で決まります。

## 制約

- Google Lens と完全同等ではありません。
- `WEB_DETECTION` は Web上の類似画像やページに依存するため、写真の撮り方や商品カテゴリによって候補が揺れます。
- 型番・刻印・タグが写っている画像は `TEXT_DETECTION` の寄与が大きくなります。
- 価格取得は Google ではなく eBay Browse `search` に依存します。
- Google Vision 導入後も、画像同定精度はベンチマークデータセットで測定する必要があります。

## 参考

- Cloud Vision API Web Detection: https://cloud.google.com/vision/docs/detecting-web
- Make a Vision API request: https://cloud.google.com/vision/docs/request
- Cloud Vision API pricing: https://cloud.google.com/vision/pricing
- Vision API Product Search documentation: https://cloud.google.com/vision/product-search/docs
- Manage API keys: https://cloud.google.com/docs/authentication/api-keys
