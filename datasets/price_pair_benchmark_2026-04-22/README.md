# Price Pair Benchmark 2026-04-22

ユーザー提供の16枚の写真から作った、品物写真と価格写真のペアデータセットです。

- 価格は `0.6掛け前` の参照価格として扱います。
- ペアはファイル番号の隣接関係と、品物/タグ内容の目視一致で確定しました。
- `benchmarkStatus=review` は、背景に別商品が写っている、または価格タグが手書きで判定に揺れがあるものです。

| ID | Status | Product Image | Price Image | Item Name From Tag | Reference Price |
| --- | --- | --- | --- | --- | ---: |
| pp_001 | include | `images/IMG_7490.jpg` | `images/IMG_7491.jpg` | Burberry TB Monogram Robin Crossbody Bag | $695 |
| pp_002 | include | `images/IMG_7492.jpg` | `images/IMG_7493.jpg` | MCM Klassik Visetos Mix Small Crossbody in White and Brown | $595 |
| pp_003 | review | `images/IMG_7486.jpg` | `images/IMG_7487.jpg` | Chanel black drawstring bucket bag with bamboo handle | $695 |
| pp_004 | review | `images/IMG_7479.jpg` | `images/IMG_7480.jpg` | Prada Logo Jacquard Canvas and Leather Shoulder Bag | $595 |
| pp_005 | include | `images/IMG_7478.jpg` | `images/IMG_7477.jpg` | MCM Metallic Studded Vanity | $575 |
| pp_006 | include | `images/IMG_7475.jpg` | `images/IMG_7476.jpg` | Fendi Dark Green Baguette Teal Blue FF Logo Hardware Shoulder Bag | $1,015 |
| pp_007 | include | `images/IMG_7473.jpg` | `images/IMG_7474.jpg` | Givenchy Olivia Green Shearling Mini Cut Out Bag | $675 |
| pp_008 | review | `images/IMG_7471.jpg` | `images/IMG_7472.jpg` | Gucci GG Monogram Beige with Black Trim Wool Pouch | $750 |

## Notes

- `pp_003`: 商品写真に背景バッグが写っています。対象は前景の黒いドローストリング/バンブーハンドルバッグです。
- `pp_004`: 商品写真にPradaバッグが2つ写っています。対象は前景左側のベージュ/ブラウンのショルダーバッグです。
- `pp_008`: 商品写真に複数のGucci商品が写っています。対象は前景のベージュ/ブラックのGGウールポーチです。
