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

## Overall Results

| Condition | Input | Median within ±30% | Include rows only | Reference within IQR | Mean abs median error |
| --- | --- | ---: | ---: | ---: | ---: |
| Google Vision | Product only | 1/8 | 1/5 | 1/8 | 72.0% |
| Google Vision | Product + price tag | 3/8 | 2/5 | 3/8 | 59.1% |
| eBay searchByImage | Product only | 2/8 | 2/5 | 2/8 | 44.5% |

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

## Next Actions

1. Product-onlyのGoogle Visionを主経路にするのは一旦避ける。
2. Google Visionは `OCR/ロゴ抽出` に限定し、検索語の品質が低いときはeBay画像検索を優先する。
3. タグ・ロゴ・型番・ブランド名が写る画像を明示的に2枚目として回収する運用にすると改善余地がある。
4. ベンチマーク指標は `median within ±30%` と `reference within IQR` を継続利用する。
5. 次の改善では、Vision候補をそのままeBayに投げるのではなく、ブランドバッグ用の検索語生成ルールを追加する。
