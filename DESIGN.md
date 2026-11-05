# Game-native

The design language of PoE Upgrade Checker. It's built the way Path of Exile's own item tooltips and panels are: a warm near-black ground, rarity-tinted centred headers, thin separators, grey labels with white values, mod text in the games' blue, and small caps instead of spaced capitals. It borrows the games' visual grammar, not GGG's property: no logos, artwork or game fonts, everything drawn in CSS.

It replaced "Wraeclast Iron" (gold corner diamonds, gradient gold text and buttons, glow), which players said looked generic. The research behind it: the games' tooltip anatomy and colours (loot-filter colour tables), and what players like in other PoE tools (one-line prices, small windows, game-like item cards, dense tables).

All of it lives in [`src/ui/css/`](src/ui/css) (base.css first, then windows, pages, polish and native), which the popup, the results window and the app pages share; the website (`site/site.css`) uses the same tokens. Use the tokens; don't add new hex values in components.

## Colour

| Token | Value | Use |
|---|---|---|
| `--void` | `#0e0c0a` | Page background |
| `--abyss` | `#0a0908` | Panel fill (popups: `rgba(8, 6, 5, .94-.95)`) |
| `--iron` / `--iron-hi` / `--iron-lo` | `#2a2118` / `#4a3c2c` / `#1f1913` | Lines: inner frame / panel edge and buttons / row rules |
| `--bronze-text` | `#aa9e82` | The games' currency tan: table headers, group headings, side navigation |
| `--gold` / `--gold-hi` | `#e7b478` / `#f3e6c4` | The games' title colour: page and card headings, the selected page / light text on the main action |
| `--stone` | `#c8c8c8` | Body text (the games' normal item colour) |
| `--bone` | `#f2efe8` | Values and strong text (white in game) |
| `--ash` | `#8a857c` | Labels and secondary text (the games' grey, a little lighter for contrast) |
| `--up` / `--down` / `--warn` | `#9a9aff` / `#e05a4a` / `#e0a84a` | Better (the games' blue) / worse / careful. Colour-blind mode: light blue / orange |
| `--rare` / `--unique` / `--magic` / `--mod` / `--rune` | `#ffff77` / `#af6025` / `#8888ff` / `#8888ff` / `#c8b48a` | Item names and mod lines, as in game |

Popup headers are tinted by rarity: rare `#3a3216`, unique `#3a2412`, magic `#23233c`, normal `#2a2622`, with a slightly lighter line under them.

## Type

- **Headings: Alegreya Sans SC** (bundled, SIL OFL): real small caps for headings, item names, verdicts, buttons, navigation and table headers. No letter-spacing and no all-caps transforms.
- **Text: Alegreya Sans** (bundled, SIL OFL): everything you read. 15 px base, help text 14 px, nothing under 13 px except short tags (12 px). No italics for emphasis: use bold or colour.
- Prices and big numbers are bold Alegreya Sans, so "ex", "div" and "chaos" stay readable.
- Fontin, the PoE1 font, isn't bundled: its licence doesn't allow passing it on without the author's permission.

## Shapes

- **Panels** are flat: a 1 px edge with a thin double line inside, like the games' panels. No corner ornaments, no gradient washes, no glow.
- **Popups** are item tooltips: a centred, rarity-tinted header band (name, then base and class), thin separators, centred verdict.
- **Verdicts** are a small-caps word in its colour with the number beside it (UPGRADE, LOSES RESISTANCE...). No boxes, in the popup or in running text (`.vchip`).
- **Square corners.** Flat chips, tiles and bars; resistance bars in the element's colour.

## Icons

- **One line set** in [`src/ui/icons.js`](src/ui/icons.js) (shapes from Lucide, ISC licence): 1.75 stroke, sized by the text around them (18 px in the sidebar), drawn in the colour of that text. In a template use `${window.ICON.warn}`; in static HTML `<i data-icon="warn"></i>`.
- No symbol characters as icons (⚠ ☠ ⚔ ◀ ☆ and the like): Windows draws many of them as colour emoji. `test/ui-look.test.js` checks this, and that the CSS has no gradients, glow or spaced capitals.
- Plain text marks stay text: ✓, →, ×, ▾.

## Buttons

| Kind | Look | Where |
|---|---|---|
| Main (`.primary`, `.find`) | Dark warm leather `#3b2a17`, bronze edge `#8a6a3c`, light text | The main action of a view |
| Gilded (`.primary.gilded`) | A lighter version of the main one | The main action on each of many repeated items (result cards) |
| Default | `#1e1a16` with the panel edge | Everything else |
| Link (`.link`) | Tan underlined text | Small asides |

## Rules

1. The ground is warm near-black and flat.
2. Colour means something: rarity, better/worse, damage type. Never decoration.
3. Gold is for headings and the selected thing only.
4. Item names and mods keep the games' colours.
5. Verdicts are words first, numbers second.
6. Text is at least 4.5:1 against its background (labels included).
7. No GGG logos, art or fonts.
