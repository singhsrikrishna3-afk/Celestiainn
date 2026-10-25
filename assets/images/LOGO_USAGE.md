# Celestia Inn — Celestial Horizon logo set

A Himalayan ridgeline under a compass star, enclosed in a medallion. Built from
the site's own tokens: gold `#E9C176` / `#C5A059` on warm dark `#161412`,
Playfair Display for the wordmark, Manrope for the legend.

## Primary circular logo

**`celestia-horizon-roundel.svg`** is the main circular logo. `CELESTIA INN`
curves along the top arc, `HOMESTAYS & BOUTIQUE INNS` along the bottom, with
the device centred inside its own ring.

| File | Ground |
|---|---|
| `celestia-horizon-roundel.svg` | dark (`#161412` and similar) |
| `celestia-horizon-roundel-onlight.svg` | light (`#F5F2EA`, paper, white) |

**Minimum size 96px.** Below that the curved legends stop resolving — use the
favicon instead, which is the same circle with the type removed.

## The rest of the set

| File | Use |
|---|---|
| `celestia-horizon-logo.svg` / `-onlight` | Horizontal lockup — site header, letterhead, email footer |
| `celestia-horizon-stacked.svg` / `-onlight` | Vertical lockup — portrait layouts, signage |
| `celestia-horizon-mark.svg` / `-onlight` | Device alone, no type — keycards, wax seals. Min 32px |
| `celestia-horizon-favicon.svg` | Browser tab, app icon. The roundel's circle at 0.64 scale, legends dropped |
| `celestia-horizon-disc.svg` | Alternate: solid disc for circular avatars (Instagram, WhatsApp, Google Business). Min 56px |

## Size floors

| Asset | Floor | Why |
|---|---|---|
| Roundel | 96px | curved legends stop resolving |
| Disc badge | 56px | straight wordmark stops resolving |
| Mark | 32px | ring and ridge begin to merge |
| Favicon | 16px | legible, though detail is lost; renders at 32 device px on retina |

## Known constraint: the wordmark is live text

The lockups set `CELESTIA INN` as `<text>` in Playfair Display rather than
outlined paths. Inlined into a page this is exact, because `style.css` already
`@import`s the font. Referenced through `<img src="…">` it is **not** —
browsers block external font loading inside an image, so it falls back to
Georgia. For print vendors, email signatures or anything consumed outside the
site, convert the wordmark to paths first.

The mark, the roundel's device and the favicon are pure geometry and carry no
font dependency.

## Palette note

`Celestia_Inn_Brand_Kit/BRAND_GUIDELINES.md` names Himalayan Forest Pine
`#18362B` as the primary logo ink. This set is gold, matching the live site and
the kit's Corporate Vector Logos. The guidelines' stated primary is the one
direction currently not shipping — worth reconciling before the kit goes to an
external printer or signage vendor.

## Superseded — previous generation

These predate the Celestial Horizon set and are kept for history only. Do not
use them for new work.

| File | Replaced by |
|---|---|
| `celestia-logo.svg` | `celestia-horizon-logo.svg` |
| `celestia-logo-stacked.svg` | `celestia-horizon-stacked.svg` |
| `celestia-emblem.svg` | `celestia-horizon-mark.svg` |
| `celestia-monogram.svg` | `celestia-horizon-mark.svg` |
| `favicon.svg` | `celestia-horizon-favicon.svg` |

Note the trap: `favicon.svg` and `celestia-horizon-favicon.svg` sit side by
side and only the second is current.
