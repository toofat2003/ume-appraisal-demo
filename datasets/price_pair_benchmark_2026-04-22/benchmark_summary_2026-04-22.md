# Price Pair Benchmark Summary 2026-04-22

## What Was Tested

8件の品物写真を査定APIに投入し、返却されたeBay参照価格の中央値を、価格タグから作った正解価格と比較した。

- 正解価格: 価格タグの表示価格。0.6掛け前の比較対象。
- 主指標: eBay参照価格の `median` が正解価格の±30%以内か。
- 補助指標: 正解価格がeBay参照価格の `p25-p75` 内に入るか。
- Product-only: 品物写真だけを入力。価格タグ写真は正解ラベルとしてのみ使用。
- Tag-assisted: 品物写真 + 価格タグ写真を入力。価格タグの品名OCRが効くかを切り分ける参考実験。

## Run Files

- Google Vision product-only: `runs/2026-04-22T04-47-14-395Z.md`
- Google Vision tag-assisted: `runs/2026-04-22T04-49-15-823Z.md`
- eBay image product-only: `runs/2026-04-22T04-50-36-120Z.md`
- Gemini 3 product-only: `runs/2026-04-22T05-18-52-373Z.md`
- Gemini 3 product + price tag, with internal product-only vs all-images selection: `runs/2026-04-22T05-21-03-059Z.md`

## Overall Results

| Condition | Input | Median within ±30% | Include rows only | Reference within IQR | Mean abs median error |
| --- | --- | ---: | ---: | ---: | ---: |
| Google Vision | Product only | 1/8 | 1/5 | 1/8 | 72.0% |
| Google Vision | Product + price tag | 3/8 | 2/5 | 3/8 | 59.1% |
| eBay searchByImage | Product only | 2/8 | 2/5 | 2/8 | 44.5% |
| Gemini 3 | Product only | 5/8 | 4/5 | 4/8 | 32.4% |
| Gemini 3 | Product + price tag, selected | 5/8 | 4/5 | 5/8 | 30.8% |

## Product-Only Google Vision Details

| ID | Expected | Identified | Ref | eBay median | Error | Result |
| --- | --- | --- | ---: | ---: | ---: | --- |
| pp_001 | Burberry TB Monogram Robin Crossbody Bag | Burberry Tb Monogram | $695 | $593 | -14.7% | pass |
| pp_002 | MCM Klassik Visetos Mix Small Crossbody | Mcm Tote Bag | $595 | $272 | -54.3% | fail |
| pp_003 | Chanel black drawstring bucket bag | Coach Shoulder Bag | $695 | $103 | -85.2% | fail |
| pp_004 | Prada Logo Jacquard Shoulder Bag | Herman Refurbished Approved | $595 | $325 | -45.4% | fail |
| pp_005 | MCM Metallic Studded Vanity | J Messenger Bag | $575 | $71 | -87.7% | fail |
| pp_006 | Fendi Dark Green Baguette | Room Paperback By | $1,015 | $4 | -99.6% | fail |
| pp_007 | Givenchy Olivia Green Shearling Mini Cut Out Bag | Vossknut Cardigan Sweater | $675 | $42 | -93.8% | fail |
| pp_008 | Gucci GG Monogram Wool Pouch | Coach Wool Handbag | $750 | $36 | -95.2% | fail |

## Interpretation

現時点のGoogle Vision product-onlyは、価格比較以前に商品同定で崩れている。Burberryだけは `Burberry TB Monogram` まで拾えて価格帯も一致したが、それ以外は `bag`、`wool`、`room`、`chair` のような汎用語・背景物・素材語に引っ張られている。

価格タグ画像も入力すると、PradaとFendiは大きく改善した。これは、タグ側の品名OCRが効けばeBay検索自体は成立しやすいことを示している。ただしMCM MetallicやGivenchyなどはタグを入れても崩れており、OCR文字列を検索語に組み立てるロジックもまだ不十分。

既存のeBay searchByImageはProduct-onlyでもGoogle Visionより平均誤差が小さかった。ただし2/8しか±30%に入っておらず、十分ではない。現状ではGoogle Visionへの単純置き換えは精度改善になっていない。

Gemini 3は、同じデータセットではGoogle VisionとeBay searchByImageの両方を上回った。特に価格タグありでは、タグに写った品名を使ってBurberry、Prada、MCM Metallicなどの品名がより具体化された。一方で、商品写真に複数商品が写っているChanel/Gucci系のreview行では、Gemini 3でもターゲット商品の切り分けに失敗した。

価格タグ画像を追加すると必ず良くなるわけではないため、アプリ側では2枚目以降がある場合に `1枚目のみ` と `全画像` のGemini同定を比較し、eBay検索結果の件数・検索語一致度・Gemini確信度から作るselection scoreで全画像側が明確に良い場合だけ採用する。これにより、任意の2枚目/3枚目を入れても、悪化しそうな時は1枚目のみへ戻せる。

## Next Actions

1. 主経路はGemini 3 image understandingに切り替える。
2. Google Vision product-onlyを主経路にするのは避け、必要ならOCR/ロゴ抽出の補助用途に限定する。
3. 2枚目は価格タグ・ロゴ・型番・素材タグなど、品名特定に効く画像として任意入力にする。
4. 複数商品が写る写真はまだ弱いため、1枚目は対象商品単体が大きく写る写真を必須ガイダンスにする。
5. ベンチマーク指標は `median within ±30%` と `reference within IQR` を継続利用する。
