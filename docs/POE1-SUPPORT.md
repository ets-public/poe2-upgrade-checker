# Path of Exile 1 support: what it would take

Research notes, 23 October 2026.

**Progress:** steps 1–5 are built (game detection and characters per game; Path of Building for PoE1; PoE1 item text; the PoE1 trade site and chaos prices; verdicts and the Character page), with unit and end-to-end tests against a simulated PoE1 trade site. Step 6, testing in the real game, is next. Not yet: cluster/timeless jewels, flasks, Craftable bases for PoE1.

## Summary

It's doable, and most of the app carries over. The work is mostly making the app game-aware, not re-inventing anything:

- **Path of Building for PoE1 runs headless with what we already ship.** Path of Building Community (PoE1, v2.67.2, MIT, the same licence as PoB2) ran on our Linux LuaJIT and `lua-utf8` with a handful of changes to `pob/server.lua`. Load, summary, sheet, equip, eval (including jewels across sockets and abyss jewels) and PoB's own weighted trade search all worked on PoB's test builds. It made no network calls.
- **The trade site is the same API without the "2".** `/api/trade/search/{league}` and `/api/trade/fetch/…`, with the same rate-limit headers and the same status options. The filter groups differ (sockets, influences, armour/weapon filters instead of `equipment_filters`).
- **The item text is close to PoE2's,** with extra sections (sockets, influences, Synthesised/Fractured, flask charges). Since 3.29 a plain Ctrl+C copies the advanced text, so the one-Ctrl+C design is unchanged.
- **The differentiator holds.** No maintained PoE1 overlay combines a Path of Building verdict on hover with trade search and pricing. Awakened PoE Trade and Sidekick price-check only. PoB-Item-Tester is an old AutoHotkey tool.

**Effort:** about 2–3 weeks of focused work for a solid beta, in the six steps below, plus 3–4 days to make playing both games with one install seamless (see below).

**Timing:** 3.30 is expected on 13 November 2026, a natural moment to launch PoE1 support. That is tight but possible for a beta.

## What changes, area by area

### 1. Game awareness (the foundation)

A `games/poe1.js` and `games/poe2.js` profile holding everything that differs:

- Trade paths: `/api/trade` vs `/api/trade2`.
- poe.ninja paths: `poe1/api/...` vs `poe2/api/...`.
- Currency units: chaos/divine vs exalt/divine.
- Slots and the Item Class → slot map.
- Filter builders.
- Stat-id prefixes.
- Which PoB to use, and its XML root (`PathOfBuilding` vs `PathOfBuilding2`).
- Gear-score profiles.
- Window matching.

**Characters get a game.** Each character (profile) gets a `game` field. It's set automatically from:

- The PoB import: the XML root says which game it is.
- The window F2 was pressed in: the title is exactly `Path of Exile` vs `Path of Exile 2`. Match it exactly, because one is a prefix of the other. The exe names are shared between the games.
- Under Proton: the Steam app id, 238960 for PoE1 and 2694490 for PoE2.

`keysender.js` currently hard-codes PoE2's Proton window class (`steam_app_2694490`). It needs both.

### 2. Path of Building 1 engine

**Vendor a trimmed copy** next to PoB2's:

- `src` is 771 MB, but 552 MB of that is tree images.
- The Lua and data outside the images is about 185 MB, of which 144 MB is tree data for about 40 tree versions. Keep only the current versions: 3.29's tree is 3.5 MB.
- Expect about 40–60 MB extra installed.
- Timeless jewel data is another 170 MB. *Since 0.5.9:* the Legion jewels' and Heroic Tragedy's tables (33 MB of zips) come with the app, read through zlib (`zlib1.dll` from PoB2's runtime on Windows); the Abyss tables (140 MB) don't, and those jewels are still taken out of the build.

**`server.lua` changes,** all tested in a working copy at `/tmp/claude-0/-home-claude/67b9a9f0-cda6-5cb0-89b9-d741af785931/scratchpad/poe1-pob/server.lua`:

1. The main object is `__mainObject__` in PoB1. (In PoB2 it's a local inside HeadlessWrapper, so our `promptMsg` checks never see it. That's a PoE2 bug to fix as well.)
2. Accept the `<PathOfBuilding>` root, and reject a PoE2 build with its own message.
3. `new("TradeQueryGenerator", …)` throws in PoB1. Fall back to `new("TradeQueryGenerator"):TradeQueryGenerator{ itemsTab = … }`.
4. Stats:
   - PoE1 has no Spirit. Use life/mana reserved and unreserved instead.
   - Add block and spell suppression.
5. Slots:
   - `Flask 1`–`Flask 5`.
   - `Ring 3` (Unseen Hand).
   - Abyssal sockets on gear.
   - Cluster jewel sockets.
6. Query options: drop `includeRunes`, and add `includeEldritch`, `includeScourge` and `includeTalisman`.
7. PoB1's headless `Inflate` is a stub. A LuaJIT FFI wrapper around zlib makes timeless jewel data load (PoB then needs a writable cache folder).

**Speed** (PoB's 3.13 test builds):

| Step | Time |
|---|---|
| Start-up | 3.2–3.6 s |
| Load (current tree) | 0.6–0.8 s |
| Eval | 0.04–0.08 s |
| Jewel across 12–13 sockets | 0.1–0.2 s |
| Trade search generation | 1.5–3 s per slot |

That's as fast as PoB2.

**Known gaps:**

- **Cluster jewels:** replacing a cluster jewel doesn't remove its notables in PoB's quick calculation, so the gain is overstated. Mark cluster jewels "not judged" at first.
- **Timeless jewels:** they can't be judged by swapping them in, because PoB applies them when it builds the tree.
- **Minion builds:** not tested yet. The fields exist.

### 3. Item text (`parser.js`, `slots.js`)

Port the rules from Awakened PoE Trade (`renderer/src/parser/Parser.ts`):

- **Sockets:** `Sockets: R-G-B B` (links and white sockets).
- **Influences:** a section of `Shaper Item` … `Warlord Item`. `Searing Exarch Item` and `Eater of Worlds Item` are appended to the previous section instead.
- **Synthesised:** a `Synthesised Item` section plus a `Synthesised` name prefix.
- **Fractured:** inferred from the mod tags.
- **Mod headers:** the `{ … }` lines, which also have Master Crafted, Veiled and Eldritch implicit variants.
- **Line suffixes:** `(implicit)`, `(enchant)`, `(scourge)`.
- **Flasks:** `Currently has N Charges` isn't a mod.

Slots:

- 5 flasks, no charms.
- Abyss and cluster jewels.
- Quivers.
- Ring 3 (Unseen Hand).
- PoE1 weapon classes: wands, claws, daggers, bows, staves, and so on.

We need real PoE1 item texts as test fixtures. Ask players, or take them from Awakened PoE Trade's tests.

### 4. Trade search and prices (`trade.js`, `listing.js`, `rates.js`)

**Trade search:**

- **Endpoints:** `/api/trade/search|fetch`. Leagues come from `/api/leagues?type=main&realm=pc` or the trade data API. Stats and items come from `/api/trade/data/stats|items`.
- **Filter groups:**
  - `armour_filters` (ar/ev/es/ward/block) and `weapon_filters` (dps/pdps/edps/crit/aps), instead of `equipment_filters`.
  - `socket_filters` (links).
  - `misc_filters` (ilvl, quality, corrupted, fractured_item, mirrored, influences).
- **Stat prefixes:** PoE1 adds crafted, fractured, scourge, veiled and others. It has no rune or desecrated.
- **PoB's weighted search** already targets `/api/trade` with PoE1 stat ids. Its data is bundled in PoB (`QueryMods.lua`, `TradeSiteStats.lua`).

**Prices:**

- **Currency:** chaos is the everyday currency and divine the high-value one. The price checker's bait and median logic is currency-neutral; only the units and formatting change.
- **poe.ninja:** `poe.ninja/poe1/api/economy/...` (the Sidekick and Awakened PoE Trade code show the endpoints). League ids are `allflame`, `standard` and so on. Discover the league at runtime.

**Unverified:**

- PoE1 *Travel to hideout*. Whisper is `POST /api/trade/whisper` with the listing's token.
- A `synthesised_item` filter.

### 5. Verdicts and pages

- **Priorities:**
  - Spirit becomes "Never run out of reservation" (mana/life unreserved).
  - Chaos resistance matters to most PoE1 builds, so turn it on by default unless the build has Chaos Inoculation.
  - Add spell suppression as an optional check.
- **Damage:** `FullDPS` was 0 on old test builds, and `CombinedDPS` was right. The existing fallback order already handles that.
- **Character page:** swap Spirit for reservation, and add suppression, block and charges.
- **Gear score fallback:** the profiles are PoE2-specific (Varashta, Spirit, runes). For the PoE1 beta, require a PoB build and skip the gear score. That's simpler and more accurate.
- **Text and branding:**
  - The name says "PoE2". Keep the name and add "now for PoE1 too", or rename later, e.g. "PoE Upgrade Checker".
  - The website, README and setup guide need a game picker.

### 6. Testing

- **Unit tests:** PoE1 item-text fixtures, PoE1 query builders, and the PoB1 server on PoB's own test builds (5 builds in `spec/TestBuilds`).
- **End-to-end:** the e2e suites run per game.
- **Real-game testing:** we need a PoE1 player, because the PoE2 character won't exercise any of this.

## Playing both games with one install

The goal: one app in the tray, one hotkey, and it simply knows which game you're in. You never pick a game; you play PoE1 tonight and PoE2 tomorrow and both just work, each with its own characters, builds, league, budget and searches.

### How other tools do it

- **Awakened PoE Trade and Exiled Exchange 2 are two separate apps,** one per game. Players who play both install both and only run the one they need. EE2 even uses the same data folder name (`apt-data`), so they're simply copies.
- **Sidekick supports both games in one app, with a manual switch.** The game comes from the league you pick in settings (`poe2.` league ids mean PoE2, everything else PoE1; `Sidekick.Common.Settings/Extensions/StringExtensions.cs`). When you change game you have to change the league.
- Nobody switches automatically. That's an opportunity: our F2 already looks at the window under the mouse, so it can tell which game you're in on every press.

### How it would work in our app

**1. Which game is this press for?** Decided on every F2, in this order:

1. **The game window.** The key sender already reports the active window and the window under the mouse (to bring the game to the front). It would also report the window title: exactly `Path of Exile 2` is PoE2, exactly `Path of Exile` is PoE1. The executable names are the same for both games, so they can't be used. On Linux under Proton the window class says it: `steam_app_2694490` (PoE2) or `steam_app_238960` (PoE1).
2. **The item text,** when the window can't tell (e.g. you pressed Ctrl+C yourself with clipboard watching on). Some things exist in only one game:
   - PoE1: sockets with colours (`Sockets: R-G-B`), influences (`Shaper Item`…), Synthesised and Fractured items, `Quivers`, `Claws`, `Wands`, flasks with `Currently has N Charges`.
   - PoE2: Spirit, runes and soul cores, `Charms`, `Quarterstaves`, `Crossbows`, `Foci`, `Desecrated`.
3. **The last game you played,** if neither says.

**2. Each game has its own active character.**

- Characters (already in the app) each get a game, set by their Path of Building import: the XML root is `PathOfBuilding` for PoE1 and `PathOfBuilding2` for PoE2.
- The store keeps an active character per game (`activeProfile: { poe1: "…", poe2: "…" }` instead of one id). An F2 in PoE1 uses your PoE1 character, and the app switches to it by itself; F2 in PoE2 switches back.
- Today's characters become PoE2 characters when the app updates, so nothing changes for current users.
- The character picker on My gear shows a small PoE1/PoE2 mark, and the sidebar shows which game and character the app is on.

**3. Kept per game** (they mean different things in each game):

| What | Why |
|---|---|
| League | Different league lists and names |
| Price range and its currency | PoE1 prices in chaos/divine, PoE2 in exalts/divine |
| Divine and currency rates (poe.ninja) | Different economies |
| Trade site data (stats, items, filters) and the cached search size | Different APIs (`/api/trade` vs `/api/trade2`) |
| Ignored stats | Stat names differ |
| Saved searches and alerts | Each search belongs to one game's trade site; alerts for the other game keep running in the background |
| Priorities defaults | Spirit vs reservation; chaos resistance on by default in PoE1 |

**4. Shared** (the same for both): hotkeys, popup position and size, colour-blind mode, start with Windows, updates, and the pathofexile.com sign-in (one account and login cookie covers both trade sites).

**5. Two Path of Building engines, one running.**

- PoB2 and PoB1 are separate copies, each started only when needed.
- Each uses about 240–270 MB of memory once a build is loaded (measured here: PoB2 243 MB, PoB1 273 MB). So when you switch game, the other game's engine is stopped straight away instead of after its usual 20 idle minutes.
- The first F2 after switching game takes about 4 seconds while that engine starts and loads your build (start-up 3–4 s, load under 1 s); every press after that is instant. The popup already shows "Checking with Path of Building…" during that.

**6. The results window and Find upgrades page** show the current game's trade results and saved searches. Switching game switches them too, so you never see a PoE2 listing while playing PoE1.

### If both games are open at once

Not the normal case, but it can happen (one minimised, or the launcher left open). Because the game is chosen per press from the window you're actually in, it still does the right thing: F2 over PoE1 judges against your PoE1 character, F2 over PoE2 against your PoE2 one. Only the engine for the game you're using stays started.

### Extra work for this, on top of the steps above

- Key sender: report the window title (Windows) and recognise both Steam app ids (Linux), and refocus whichever game was under the mouse.
- Store: per-game active character, per-game settings, and moving today's data to PoE2 on update.
- Game detection with the three fallbacks, plus unit tests with item texts from both games.
- Two engine instances in `pobengine.js` (it's already a factory, so this is small), and stopping the unused one.
- UI: game mark on characters, current game in the sidebar, saved searches filtered by game.

About 3–4 more days. It belongs in step 1 (game awareness), so the rest is built on it from the start.

## Risks

- **Installer size:** grows by about 40–60 MB, plus an optional 170 MB timeless jewel download.
- **Two PoB copies to keep current:** PoB1 updates every league.
- **Cluster and timeless jewels:** verdicts are inaccurate at first, so they're marked as not judged.
- **GGG's developer page** says standalone apps "must use a public OAuth client if interacting with our APIs". Every existing tool calls the trade endpoints directly, as we do for PoE2, so the risk is the same for both games, but it's worth knowing.
- **No PoE1 tester yet.**

## Suggested order

1. Game profiles, per-character game and automatic game detection on every F2, with no behaviour change for PoE2.
2. PoB1 vendored and the dual-mode server, with unit tests on PoB's builds.
3. Item text and slots, with fixtures.
4. Trade search and prices.
5. Verdicts, Character page and setup guide.
6. Beta release ("PoE1 beta") for 3.30, then cluster and timeless jewels.

## Sources

- **Path of Building Community:** https://github.com/PathOfBuildingCommunity/PathOfBuilding, commit 16de4b8 (8 Sep 2026). Headless test scripts are in the scratchpad folder above.
- **Awakened PoE Trade** (PoE1): https://github.com/SnosMe/awakened-poe-trade
  - `pathofexile-trade.ts` for queries
  - `Parser.ts` for item text
  - `Shortcuts.ts` for the 3.29 advanced-copy note
- **Exiled Exchange 2** (its PoE2 fork): https://github.com/Kvan7/Exiled-Exchange-2, for the trade2 differences.
- **Sidekick:** https://github.com/Sidekick-Poe/Sidekick
  - `ProcessProvider.cs` for exe names
  - `NinjaClient.cs` for poe.ninja
- **GGG developer page:** https://www.pathofexile.com/developer (rate limits, tool policy).
- **League dates:** https://www.arpg-timeline.com/game/path-of-exile and https://poe.ninja/poe1/api/data/index-state.
