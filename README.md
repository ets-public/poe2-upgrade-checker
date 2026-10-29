<p align="center"><img src="docs/banner.png" alt="PoE Upgrade Checker: is it really an upgrade for your build? Path of Building decides." width="100%"></p>

<p align="center">
  <a href="https://poe2upgrade.com/download"><img alt="Download" src="https://img.shields.io/github/v/release/ets-public/poe2-upgrade-checker?include_prereleases&label=download&color=8e1a1a&labelColor=0a0c10&style=for-the-badge"></a>
  <img alt="Windows" src="https://img.shields.io/badge/Windows-10%20%2F%2011-2c3038?labelColor=0a0c10&style=for-the-badge">
  <img alt="Linux" src="https://img.shields.io/badge/Linux-experimental-2c3038?labelColor=0a0c10&style=for-the-badge">
  <img alt="Free" src="https://img.shields.io/badge/price-free-7a6545?labelColor=0a0c10&style=for-the-badge">
</p>

<p align="center"><b><a href="https://poe2upgrade.com">poe2upgrade.com</a></b></p>

**PoE Upgrade Checker** is a small overlay that sits in your system tray while you play Path of Exile 2, or Path of Exile 1 (new in 0.5.1 and still marked beta, more [below](#path-of-exile-1-beta)). It answers two questions in game:

| | |
|---|---|
| **Is this an upgrade?** Hover an item and press **F2**. With your Path of Building export loaded, the app runs **Path of Building's own calculations** on your build: what the item does to your DPS (or minion DPS), effective HP, resistances and Spirit compared with what you wear. Items that would drop a resistance or cost you damage are flagged in red, never called an upgrade. | <img src="docs/popup.png" alt="The popup: Doom Vise is an UPGRADE, +26.8 points for your build, and caps your lightning resistance" width="400"> |
| **Where's a better one?** One click searches the official trade site for upgrades within your budget, weighted by what each stat is worth to your build. Results open in the app, judged against your gear, with *Travel to hideout* and a ready-made whisper. | |

<sub>Screenshots of the app with a real Path of Building build (a Disciple of Varashta summoner). Trade listings in them are examples.</sub>

## Download

1. Get **`PoE-Upgrade-Checker-Setup-x.y.z.exe`** from the [newest release](https://poe2upgrade.com/download) and run it. It installs for your Windows user only, so no admin rights are needed, and **updates itself**.
   - Prefer no install? Use the **Portable** .exe from the same page. It doesn't auto-update.
   - Windows may warn about an unrecognised app because the installer isn't code-signed. Click *More info → Run anyway*.
2. In PoE2, go to **Options → Graphics** and set **Windowed Fullscreen**, so the overlay can draw over the game.
3. Hover an item and press **F2**. The first-run guide walks you through adding your Path of Building build and your gear.

**On Linux?** See [Linux (experimental)](#linux-experimental).

**Had "PoE2 Upgrade Checker"?** It's the same app, renamed when it started supporting PoE1. It updates itself to the new name, and your characters, builds and settings stay as they are.

## Features

- **Judged by Path of Building, for any build:**
  - Paste your PoB2 export on *My gear*. The app bundles Path of Building's calculation engine and checks every item against your build: DPS / minion DPS, effective HP, resistances against the cap, Spirit, attribute requirements.
  - *Find upgrades* builds its trade search with Path of Building's own search generator (like PoB's Trader), then checks every listing exactly.
- **Resistances come first:**
  - Items that cap a resistance you're short of are marked "✓ Caps your … resistance" and go to the top of trade results.
  - Items that drop a resistance off the cap get a red **LOSES RESISTANCE** verdict with exactly what drops, e.g. "Lightning 75% → 38%".
  - **Chaos Inoculation** is recognised, and chaos resistance is then ignored everywhere.
- **Never breaks your build:** an item that costs a big part of your damage (**LOSES DAMAGE**), leaves you short of Spirit, costs you 3% or more movement speed or can't be worn is flagged, however much else it adds. Each check can be switched off under *Priorities*.
- **Character page:** your whole character from Path of Building: DPS or minion DPS, effective HP, energy shield, resistances against the cap, the biggest hit you can take, Spirit, attributes, skills with supports, keystones and ascendancy.
- **Upgrade popup:** the verdict, the change in every stat, each mod's tier and roll, open prefixes and suffixes for crafting, and *What's it worth?* (or **Price by chosen stats…** to pick exactly which stats and minimums the price check matches, with a total elemental resistance row and 80/90/100% minimum buttons). Links to the wiki and poedb.
- **League start:** the campaign route for both games, step by step, with every passive point, trial, labyrinth and permanent reward counted as you go, then the first steps into the endgame. A small overlay over the game shows the step you're on and the next one (Ctrl+Shift+L). Switch on *Follow my zones* and it moves on by itself as you enter each area (it reads the game's log, Client.txt); otherwise tick steps off by hand. Every optional quest is listed too, marked *Optional*, or switch on *Endgame rush* for only the fastest way to the endgame (it keeps every passive point and permanent reward). It keeps your characters apart: only the character the route is for moves it on, so playing your main in between doesn't touch it. It warns when you're out-levelling a zone (or under-levelled) and losing experience, times each act against your best run, and in PoE1 says which quest gem to take and which to buy at each hand-in for your Path of Building build. Link your app characters to their in-game names and the app switches to the one you're playing by itself. PoE1 route for 3.29, PoE2 route for 0.5.5: updated for 3.30 and 1.0 once their changes are known.
- **Where to spend:** every slot searched in your price range and checked with your build, ranked by how much better your build gets **per divine** ("Gloves: +14% for 3 div. Amulet: +6% for 20 div."). When resistances are short, it also looks for **two items that cap them together**. With jewel sockets on your tree there's a **Jewel** row too (empty sockets counted first), saying which socket the best jewel goes in. Click an item's name to open that listing in the results window. Without a Path of Building build (PoE2), it ranks by gear score instead.
- **Price-only hotkey (F3):** a small popup with just the item's price (poe.ninja, or the trade site for rares, waystones, maps and tablets), and how sure it is (solid price, rough price or a guess). Every trade listing is compared with your item, so better ones don't push your price up; your own listing is left out; and when nothing listed is close you get a range instead of one made-up number. *Too low / About right / Too high* on each price records how far off it was, for tuning. About 3 hours after a trade price check the app searches the same thing again (instant buyout listings only) and tells you how many were gone, sold or taken down, and at what asking prices: shown the next time you check that item, and under *Check an item*. The same item again within an hour answers at once. F2 still does the full check.
- **Map, waystone and tablet check:** F2 on a map, waystone or precursor tablet. Path of Building works out what the player mods do to *your* character ("–12% max resistances: effective HP –14%") and what the monster mods do: extra damage, penetration, crits, speed and accuracy go on Path of Building's enemy, so each says how much smaller the biggest hit you survive gets and how much less long you last; tougher monsters (resistances, armour, more life) say what they do to your damage and kill time. The mods come in groups (acting on you, monsters hit harder, tougher monsters, more monsters, loot, league content), with a map boss group, the waystone's rewards, and what a tablet adds, what its mods are for and its uses left. Tablet wording is read as the waystone's, so Path of Building works out tablet mods too. Reflect, no leech and no regeneration are checked against what your build relies on, and you can mark any mod dangerous, careful or fine.
- **Waystones, maps and tablets:** *What's it worth?* prices them on the trade site by tier and their numbers (item rarity, pack size, waystone drop chance), or a tablet by its kind, uses left and mods.
- **Prices for everything else:** F2 on currency, fragments, essences, runes, divination cards, gems (by level, quality and corruption), maps and uniques (by links) shows its poe.ninja price, the whole stack's, and the 7-day trend.
- **Prices in chaos too (PoE2):** every price also says what it is in chaos orbs, from poe.ninja's rate ("≈ 494 ex (0.7 div · 35 chaos)").
- **Gem check:** F2 on a skill or support gem: if your build uses that gem, Path of Building swaps in this one's level and quality and shows the DPS and effective HP change.
- **Selling helper:** for anything poe.ninja prices, a suggested listing price a little under poe.ninja and *Copy price note* (`~price 4 divine`) to paste into the item's note in a premium stash tab.
- **Best runes and soul cores (PoE2):** on the Character page, Path of Building tries every rune, soul core and idol that fits each socket on your gear (the best tier your level can use), with an added socket where there's none yet (an Artificer's Orb). Runes the copied text doesn't name are worked out from their mod line (or it shows what yours gives now). It lists the best for each socket with what it does for your build and its poe.ninja price, what all of them do together, and which are the best value to buy first. The loot filter can highlight them.
- **Best anoint / instil:** on the Character page, Path of Building tries every notable that can go on your amulet and lists the best for your build, with the oils (PoE1) or distilled emotions (PoE2) each takes.
- **Boss check (PoE1):** on the Character page, how many of each big boss hit you can take (Path of Building's boss presets, Pinnacle and Uber), e.g. "Shaper Slam: one-shot".
- **Search strings:** on the Character page, a search to paste at vendors and in your stash (movement speed, the resistances you're short of, life, + gem levels, three linked sockets in PoE1), and one for the map device that leaves out maps or waystones with the mods you marked dangerous. The map card can copy that one too.
- **Leveling mode** (Find upgrades): only items you can wear at your level, in every upgrade search.
- **Search history** (Find upgrades): your last 30 trade searches, to run again or save.
- **One per seller** (trade results): only each seller's best listing.
- **Loot filter from your build** (My gear): highlights the uniques your guide uses that you don't have yet, the best runes for your sockets, better bases of the kinds you wear (more base defence or damage, usable now or within 5 levels), your own bases (from your level while levelling) and identified magic and rare items with two or more of the mods Path of Building values most for each slot (weapons and offhands too, by the affix names their base can roll). It's saved as a copy of your own filter with this section in front; My gear says when your gear or build has changed since, and **Remake** (or the notification you get when it goes out of date) writes it again in place with your filter read again.
- **Trade search:**
  - *Better for my build*, *same stats or better*, *craftable bases*, or a custom search built from any of the trade site's ~3,600 stats.
  - Price range in divines (or exalts, using poe.ninja's live rate), ignored and excluded stats, and saved searches with **new-listing alerts**.
- **Your gear:**
  - Every slot, including weapon swap, jewels, flasks and charms.
  - Import from Path of Building (pobb.in links or codes). A pobb.in link can be read again with one click, or link the build file PoB saves and the app follows it each time you save.
  - **No PoB link?** Link a guide's Build Planner file (`.build`): the tree, skills and the guide's gear become a Path of Building build, with a stage picker for levelling guides (or *Follow my level*). A *Skills* panel sets gem levels and quality (all, or one gem apart), the main skill items are judged on and which others count in the total DPS; *Compare skills* has Path of Building work out each skill's damage, so you can see which one the guide really runs on.
  - Several characters, each with their own gear and build.
- **Gear score fallback:** without a PoB build, a 0–100 gear score from build profiles (minion summoner, ES caster, life + res) and your own stat weights.
- **Built for playing:**
  - Looks like the games' own item tooltips: rarity-coloured names, mods in the games' blue, no clutter.
  - Compact popup.
  - Pin it to the cursor or a screen edge, or drag it anywhere and it stays there.
  - Text size and colour-blind options.
  - Starts with Windows.

## In pictures

<p align="center"><img src="docs/popup-warnings.png" alt="Two popups: LOSES RESISTANCE, lightning resistance 75% to 38%; and LOSES DAMAGE, minion DPS down 20%" width="100%"></p>
<p align="center"><sub>Items that cost you a resistance or your damage are never called an upgrade.</sub></p>

<table>
<tr>
<td width="42%"><img src="docs/results.png" alt="Trade results judged by Path of Building, each listing with its verdict, resistances first"></td>
<td><img src="docs/character.png" alt="The Character page: DPS, effective HP, resistances and skills calculated by Path of Building"><br><br><img src="docs/where-to-spend.png" alt="Where to spend: every gear slot searched in your price range, ranked by points per divine"></td>
</tr>
<tr>
<td><sub>Trade results: every listing checked with your build, the ones that cap a resistance first.</sub></td>
<td><sub>The Character page, and Where to spend: what each divine buys you, slot by slot.</sub></td>
</tr>
</table>

## Fair play and privacy

- **Nothing touches the game:**
  - It never reads game memory or the game's data files, and never injects anything.
  - The one game file it can read is the game's **log (Client.txt)**, and only after you switch on **Follow my zones** or **Switch this app's character by itself** in *League start*: it reads only the lines saying which area you entered, your level and your quest rewards (with your characters' names), keeps nothing else, and sends nothing anywhere. GGG allows reading the log as long as you know about it.
  - Its only input to the game is **one copy keystroke per hotkey press**: Ctrl+C (Ctrl+Alt+C with *advanced copy*), the same as copying an item yourself. It's only sent when the game is the active window; to make sure the game gets it, the app may bring the game window to the front, or nudge the mouse by one pixel when its own popup was covering the item.
- **Where data goes:**
  - The official trade site (pathofexile.com) for searches and listings.
  - poe.ninja's prices, through a small cache on poe2upgrade.com as poe.ninja asks desktop apps to do (straight from poe.ninja only if that cache is down).
  - pobb.in, only when you paste a pobb.in link to import a build.
  - GitHub, to check for and download updates.
  - Path of Building runs locally on your PC.
  - **Usage statistics** (on by default; turn off with **Settings → Send anonymous usage statistics** or in the first-run guide, and then nothing is sent): when the app starts and every few hours it sends poe2upgrade.com a random install number made on your PC (it stays the same, so we count people rather than starts), the app version, Windows or Linux, beta or not, and which of the two games you used that day. No account, character, items, builds or searches, and the site doesn't keep IP addresses.
  - Your gear, builds and settings stay on your PC, in `%APPDATA%\PoE2 Upgrade Checker` (Linux: `~/.config/PoE2 Upgrade Checker`). The log never contains what you copy.
- **Signing in is optional** and only used for *Travel to hideout* and bigger searches. You sign in on pathofexile.com's own login page, in a separate browser profile kept on your PC (the login cookie and the site's own stored data); **Settings → Sign out** clears it. That window stays on pathofexile.com and its sign-in providers and gets no browser permissions. Without signing in, the app only makes its own requests to the trade site and never retries them through a browser page.
- **Not affiliated:** this is a fan-made tool, not affiliated with or endorsed by Grinding Gear Games.

## First-time setup

The **setup guide** opens on first run. You can reopen it from **My gear → Setup guide**.

1. **Paste your Path of Building export** (PoB2: *Import/Export Build → Generate*, or a pobb.in link) on *My gear*. This is what makes the verdicts exact, for **any class and skill**: the app runs Path of Building's calculations on your build. It also fills your gear slots.
2. **Copy what you wear:** open your character screen, hover each item, press **F2**, then click **Set as …** in the popup. Items copied in game replace PoB's in the calculation, so it uses exactly what you have on.
3. Check your **resistances** on My gear. They're filled in from PoB; if PoB's numbers disagree with your character sheet, My gear tells you (usually a charm or buff ticked in PoB's Configuration tab).
4. Check that PoB's **main skill** and **Configuration** match how you play: the verdicts are only as good as the build you give it.
5. Set your **Priorities** on My gear (the defaults suit most builds) and, if you like, the damage vs survivability slider.

**Characters:** the selector on My gear keeps separate gear, build and resistances for each character.

## Path of Exile 1 (beta)

PoE1 support is part of the normal release since 0.5.1. It is still marked *beta* in the app while it gets more testing.

The app works for **Path of Exile 1** too. It knows which game you're in on every F2 (from the game window), and each game has its own characters, league, prices and saved searches, so you can play both without changing anything.

- **The first F2 in PoE1** makes a PoE1 character. Paste your **Path of Building Community** export (or pobb.in link) on *My gear*: PoE1 items are judged by Path of Building only (the gear score is for PoE2 builds).
- **Verdicts, Find upgrades and What's it worth?** work as in PoE2, on the PoE1 trade site, with prices in chaos and divines (poe.ninja's PoE1 rates).
- **Links and flasks:** an item with fewer links than the gems you use in that slot is flagged, and flasks are tried in your flask slots.
- **Not judged yet:** cluster jewels and timeless jewels. *Craftable bases* is PoE2 only for now.
- It's new: if something looks wrong, email support@poe2upgrade.com with the log (Tray → Open log).

## Character page

**Character** in the sidebar shows your character as Path of Building calculates it, with the gear you copied in game:

- **At a glance:** class, ascendancy, level, passive points, main skill, Chaos Inoculation, and big numbers for (minion) DPS, effective HP, energy shield, mana, free Spirit and movement speed.
- **Minions:** DPS, average hit, uses per second, crit chance and damage, life, armour, effective HP and resistances.
- **Defences:** effective HP, energy shield with its recharge, life, ward, armour and physical reduction, evasion, block, stun and ailment thresholds.
- **Resistances** as bars against your cap (with how far over or short), and the **biggest hit you can take** of each damage type.
- **Spirit & mana**, **attributes** against your gear's requirements, charges, presence radius.
- **Skills** with their supports (main skill first), **passive tree** keystones, ascendancy and notables, and your **gear** with gear scores.

It updates when you change gear or switch character; *Recalculate* reruns it. Without a PoB build it shows your resistances and gear and how to get the full sheet.

## The popup

- **Verdict:** **UPGRADE**, **SMALL UPGRADE**, **SIDEGRADE**, **DOWNGRADE**, **UPGRADE, BUT…** (with the reason), **LOSES RESISTANCE** or **LOSES DAMAGE**, e.g. "+12.4% for your build vs Doom Vise". Underneath: what Path of Building says changes (minion DPS, effective HP, ES, Spirit, each resistance against its cap).
- **Compact view:** you see the top changes and two buttons, **Find upgrades** and **What's it worth?**. Click **More** for the full change table, Set as …, Items like this one, Craftable bases and Custom search. Settings → Popup can make **Full** the default.
- **Craft info:** with *advanced item descriptions* turned on in game, the popup shows open prefixes and suffixes, e.g. "Open: 2 prefixes, 2 suffixes – craftable", and under *More* each mod's tier (T1 is best) and how high it rolled.
- **Uniques** get a Path of Building verdict too, plus *What's it worth?* and *Find cheaper copies*. **Unidentified** items aren't rated.
- While the game copies, the popup shows "Reading item…". If you press **Ctrl+C** yourself on something that isn't gear (currency, gems), no popup appears.
- **Settings → Popup:** position (next to the cursor, left, right or top of the screen), text size, a colour-blind palette (blue and orange), and prices shown in several units, e.g. "220 ex (0.3 div · 18 chaos)" (chaos in PoE2).

## Verdicts by Path of Building (any build)

With your PoB export loaded, every item (in the popup and in trade results) is checked by swapping it into your build in Path of Building and comparing the numbers:

- **Damage:** your Full DPS if your PoB adds skills up, otherwise your minions' DPS (summoners), otherwise your main skill's DPS.
- **Survivability:** PoB's effective HP, which accounts for life, energy shield, resistances and mitigation.
- **The score** is the % change, weighted 60/40 damage/survivability by default (slider on My gear). +3% or more is an **UPGRADE**, +1% to +3% a **SMALL UPGRADE**, within ±1% a **SIDEGRADE**.
- **Priorities** (My gear), all on by default except chaos:
  - **Cap my resistances first:** while a resistance is under the cap, each point an item adds toward it counts +0.5% on its score, and *Find upgrades* gives the resistances you still need extra weight. *Including chaos* counts chaos resistance too (ignored with Chaos Inoculation).
  - **Never lose damage:** an item that costs more than 5% of your damage is **LOSES DAMAGE**, however much resistance or life it adds, and *Find upgrades* only looks at listings with as many of your damage mods as the item you wear (up to 2).
  - **Never run short of Spirit** and **Keep attribute requirements met:** otherwise it's **UPGRADE, BUT…** at best, with the reason.
- **Losing resistance** (off the cap, or further under it) is always its own red **LOSES RESISTANCE** verdict with a banner.
- **Rings** are tried in both ring slots; the better one counts.

- **Jewels** are tried in every jewel socket you've allocated on your PoB tree, replacing the jewel there (or in an empty socket); the best socket counts, and the verdict says which one, e.g. "vs Entropy Star (Socket #2)". *Find upgrades* for a jewel uses PoB's jewel search (radius jewels as radius jewels).

Anything PoB can't read falls back to the gear score below.

## Finding upgrades

- **Find upgrades** (in the popup, or next to each slot on My gear) runs **Better for my build** for that slot:
  - With PoB: Path of Building weights the search by what every mod that can roll there is worth to your build, then each listing is judged exactly. The trade site limits how big a search can be, so signing in (Settings → Trade site account) allows a fuller one.
  - Without PoB: listings that beat your gear score in that slot, with at least two of the slot's key stats.
- The **Find upgrades** page has everything in one bar: the item, price range, currency, sellers and league, with ignored stats and saved searches next to it. It lists your equipped items and the items you copied recently. Its other searches:
  - **Same stats or better** than your item. Every mod becomes a filter with your value as the minimum, and one may be missing if the item has 4 or more. If nothing is listed, it loosens to 90%, then 80%, then 65% and tells you which level found listings. Rune and enchant bonuses are left out, because you can socket your own. Uniques are searched by name.
  - **Craftable bases:** rare, uncorrupted bases of the same type with the slot's key stats rolled high and an open prefix and suffix.
  - **Custom search:** untick stats you don't want, change the minimums or set them all to 90% / 80% / 70%, and add any trade-site stat, then **Search with ticked stats**.
  - **By my weights** (only when your build is turned off): anything that scores higher with your own stat weights.
- **Items like this one** (popup, for something you copied that isn't equipped) searches for that item's stats.
- **Ignored stats:** tick e.g. *All resistances* if you don't want them to count. **Ignore** leaves them out of scores and searches; **Exclude listings with it** also hides listings that have them. Click **⊘** next to any stat in the popup to ignore just that one.
- **Stat database:** the **Browse stats…** buttons open a searchable list of every stat the PoE2 trade site knows, filterable by kind (explicit, implicit, rune, desecrated…) and by what you've seen on that item type.
- **Sellers:** the default is *Instant Buyout + In Person*. "In Person (online) only" leaves out merchant listings, which are most of the market.
- **Price range:** e.g. "from 5 to 20 Divine Orbs". The minimum filters out cheap junk; leave either end empty for no limit. The Divine→Exalted rate comes from poe.ninja (current league, refreshed hourly), so exalt-priced listings are included too.
- The league defaults to the current challenge league and is remembered when you change it.

## Gear score (without Path of Building)

Without a PoB build (or for items PoB can't read), every item gets a **gear score from 0 to 100** for how useful it is to your character, with a grade: **S** 85+, **A** 70+, **B** 55+, **C** 40+, **D** below that. Pick the closest profile under **Build & stats** (importing a PoB build picks one for you). The minion summoner profile, for example:

- **Weapon / focus / amulet / helmet:** + Level of all Minion Skills.
- **Sceptre:** Spirit and ally damage.
- **Body armour and amulet:** Spirit.
- **Armour pieces:** Energy Shield.
- **Rings:** minion damage and crit.
- **Boots:** movement speed.
- **Everywhere:** resistances, life, mana and Intelligence.

Each slot is scored only on stats that can roll there. A perfect item for that slot is about 100, and stats your build doesn't use add nothing.

- **Popup:** shows the item's score next to yours, e.g. "45 C · Gear score · yours 56 (-11)". Click **why?** for the stats that scored, how good each roll is, what's missing, and which mods are useless to you.
- **Results window:** without a PoB verdict, every listing shows its gear score, and you can sort by **Best gear score**.
- **My gear tab:** shows each slot's score, your **overall gear score**, and **Upgrade first:** your three weakest slots. Click one to search for an upgrade.
- Stats you've set to ignore don't count. Uniques and unidentified items aren't rated.
- **Resistance caps:** resistance only counts up to your cap. If you're already capped on fire, fire res on a new item scores nothing, and **why?** says so.
- **Jewels, weapon swap:** jewels (6 slots), Weapon 2 and Offhand 2 are tracked and scored too. Open *Weapon swap, flasks, charms & jewels* under the slot list on My gear. The overall score uses main gear only.
- **Build & stats page:** choose a profile (**Minion summoner (ES)**, **ES spellcaster**, **Life + res**, or off) and use the **gear score editor**: for each stat, set 0× to 3× how much it matters to you. *Reset* undoes it. *How the gear score works* explains it in the app.

## Trade results in the app

Searches show their listings in a **results window** (always on top) instead of the browser:

- Each listing is judged against what you wear, e.g. **UPGRADE +8.2% for your build**, with the stat changes and what Path of Building says underneath. Listings that lose resistance or damage get a red border and banner.
- **Sort** by *Resistances first* (the default with *Cap my resistances first*: items that cap one on top, items that lose one at the bottom), best upgrade, best gear score, **best value** (upgrade per divine spent), cheapest, or the trade site's order. Tick **Upgrades only** to hide the rest, and pick how many stat changes each card shows (3–8 or all).
- The header counts how many listings are upgrades for you, cap a resistance, or lose resistance or damage.
- **Travel to hideout** on Instant Buyout listings (sign in to pathofexile.com once the first time), **Copy whisper** for the rest, and **on trade site ↗** to open just that seller's listing in your browser.
- **Load 10 more**, **Open on trade site**, and **☆ Save search**.
- Prices in any currency are converted with poe.ninja rates, so 300 ex and 1 div compare correctly. If the listings can't be loaded, it opens the browser instead.

## More

- **What's it worth?** (popup) looks up listings like the copied item, ignoring your price range and ignored stats, and shows them cheapest-first with a price, e.g. "Worth about 2 div (most 1 – 3 div)".
  - Rare and magic gear is searched the way buyers search: total resistances, life, attributes and movement speed as the trade site's totals, the item's Armour / Evasion / Energy Shield or a weapon's DPS, and its other worthwhile mods, each within a range of the item's values (filler like light radius or stun threshold is left out).
  - Only listings from the last 3 days at first (then a week, then 2 weeks), from sellers who are online: items that have sat unsold for weeks don't set the price.
  - The price is the middle of the cheapest five sellers, with price-fixing baits left out, since what an item sells for is near the bottom of the market.
  - It says how sure it is: *solid price* (plenty of close, recent listings at similar prices), *rough price* or *a guess*. Unless it's a guess, it also suggests a price to list yours at (just under the cheapest) with *Copy price note*.
- **Saved searches** (Find upgrades page): run a saved search again with one click. It shows how many are listed now, e.g. "31 listed (+6 since last time)".
- **Alerts:** tick **Alert** on a saved search and choose how often to check. New listings give a Windows notification; click it to see them. Checks are spaced out to respect the trade site's rate limits.
- **Results window:** Esc hides it, and **Ctrl+Shift+D** (changeable in Settings) shows it again. It remembers its size and position, and comes back to the front when you search from the app.
- **Trade site account (optional):** Settings → Trade site account opens the pathofexile.com login inside the app. Signed in, searches can be bigger (more weighted stats) and *Travel to hideout* works from the app.
- **Searches pace themselves** to the trade site's rate limits (read from its replies), so you don't get locked out for a minute.
- **Settings → Startup:** start with Windows (quietly in the tray), and choose whether the main window opens on start.

## Support

Questions, bugs or ideas: email **[support@poe2upgrade.com](mailto:support@poe2upgrade.com)** or [open an issue](https://github.com/ets-public/poe2-upgrade-checker/issues). If F2 or a verdict looks wrong, attach the log (Tray → Open log) and, for a verdict, your pobb.in link.

## Hotkey & troubleshooting

- Change the hotkey under **Settings → Hotkeys**. Click the box, press your keys, then click Save.
- **Show a test popup** checks that the overlay can draw at all.
- **Open log file** shows what happened on each press. It's also in the tray menu.
- Nothing happens in game? Check the tray menu says "Hotkey: F2", that PoE2 is in Windowed Fullscreen, and what the log says.
- **When F2 finds nothing**, the popup says why, e.g. the game wasn't the active window, the mouse wasn't over the game, or the game runs as administrator (Windows then blocks the app's Ctrl+C; start the game normally).
- The app takes care of the usual causes itself: if one of its own windows is in front (you clicked the results window), it brings the game back first, and if its popup is under the mouse, it hides it before copying. It still sends only **one** Ctrl+C per press.
- The popup closes when you move the mouse away from it, when you click ×, or after the time set in Settings. Esc is left to the game.

## Linux (experimental)

For PoE2 running through **Steam with Proton** (or Lutris/Heroic) on desktop Linux: Ubuntu, Fedora, Arch, Bazzite and so on, on X11 or Wayland.

1. Download **`PoE-Upgrade-Checker.AppImage`** from the [newest release](https://poe2upgrade.com/download) and put it where you want to keep it (e.g. `~/Applications`).
2. Make it executable and run it: right-click → Properties → *Allow executing as program*, or `chmod +x PoE-Upgrade-Checker.AppImage && ./PoE-Upgrade-Checker.AppImage`. It **updates itself** like the Windows installer, in place: the file keeps its name, so shortcuts and *Start with your desktop* keep working (a `PoE2-Upgrade-Checker.AppImage` from before the rename keeps that name too).
   - Had a version-named file from 0.4.1 or older (`PoE2-Upgrade-Checker-0.4.1.AppImage`)? Its next update renames it to `PoE-Upgrade-Checker.AppImage` once: start it from the new name (that also fixes the autostart entry) and update any shortcut you made.
   - Some distros need FUSE for AppImages (e.g. `sudo apt install libfuse2` on Ubuntu 22.04+).
3. In PoE2 use **Windowed Fullscreen**, hover an item and press **F2**.

How it works on Linux, and what to check if F2 doesn't:

- **Path of Building** runs inside the app as on Windows (a bundled LuaJIT), so verdicts are the same.
- **Sending Ctrl+C to the game** uses X11's XTest through the `python3` that comes with almost every distro – nothing to install. The game runs under Proton as an X11 window, so this also works on **Wayland** desktops (through XWayland). If `python3` or the X11 libraries are missing, the app uses `xdotool` if it's installed; otherwise press **Ctrl+C** on the item yourself – the app picks it up from the clipboard.
- **The F2 hotkey** works while the game (or another X11 window) is focused. On some Wayland desktops global hotkeys don't reach native Wayland windows; in game that doesn't matter.
- The app runs as an X11 app (XWayland on Wayland) so it can put the popup next to the mouse.
- **Steam Deck:** desktop mode works like any Linux desktop; gaming mode doesn't allow other windows over the game.
- Not working for you? Please [open an issue](https://github.com/ets-public/poe2-upgrade-checker/issues) with your distro, desktop (GNOME, KDE…), X11 or Wayland, and the log (tray → Open log file). It's in `~/.config/poe2-upgrade-checker`.

## Notes / limits

- **Stash value tracking was taken out** until GGG releases a stash API for PoE2 (their developer docs list it as PoE1 only). Reading tabs from screenshots or via public tabs wasn't reliable enough.
- Flasks and charms can be saved but aren't scored.
- The *Never lose damage* and Spirit/attribute checks need Path of Building; the gear score fallback doesn't have them.
- Two-handers are compared against your weapon plus offhand together.
- Your data lives in `%APPDATA%\poe2-upgrade-checker` (Linux: `~/.config/poe2-upgrade-checker`).

## Dev

- `test-build.bat` builds a local portable test .exe (no release) and checks the PoB engine starts (`tools/pob-smoke.js`).
- The look is **Game-native**; colours, type, components and rules are in [DESIGN.md](DESIGN.md).
- **Code layout:**
  - `src/main.js` keeps the shared state (store, windows, log) and starts everything. Each part of the app is a module in `src/features` (or `src/app/guard.js`, which runs first) that reaches the rest through one context object, `C`.
  - `src/core` holds the pure logic (parsing items, trade searches in `core/trade/`, scoring), with the unit tests in `test/`.
  - `src/ui` holds the windows: `settings.js` and `settings-*.js` for the settings window, `render*.js` (shared by every window) and the styles in `src/ui/css/`, loaded in order.
- `npm test` runs the parser, scorer, trade-query, listing, PoB import and PoB verdict tests.
- `node tools/get-pob.js` downloads the pinned Path of Building into `vendor/pob` and builds `pobhost.exe` (a small host for PoB's LuaJIT, compiled with the C# compiler that ships with Windows). The build scripts run it for you.
- `build-exe.bat` (or `npm run dist`) builds the installer and the portable .exe locally, without publishing. On Linux, `npm run dist:linux` builds the AppImage (needs git, gcc and make for the Path of Building engine).
- **Releasing a new version:** double-click `release.bat`. You need [Git for Windows](https://git-scm.com/download/win) installed once. The script then does everything else:
  1. It picks the next version and asks you to confirm with Enter.
  2. It turns *Unreleased* in `CHANGELOG.md` into this version's release notes.
  3. It uploads to GitHub and tags the version.
  4. GitHub Actions builds the installer and the portable .exe on Windows, runs the tests and attaches both to the release with the notes.
  5. It waits for the build, then opens the release page. If the build failed, it opens the log instead.
  - Options: `release.bat -Version 0.5.0` (pick the number), `-Yes` (no questions), `-NoWait` (don't wait for the build).
  - **A beta for testers:** `release-beta.bat` publishes a version like `0.5.0-beta.1` as a GitHub *pre-release*. Installed copies of the normal version never update to it; whoever installs it from the release page gets the next betas and then the finished version. The changelog's *Unreleased* section is its release notes and stays as it is, so the next `release.bat` (which offers `0.5.0`) still lists everything.

## License

Free and open source under the **GNU General Public License v3** ([LICENSE](LICENSE)), with a few additional terms in [NOTICE.md](NOTICE.md). In short: you can fork it, change it and release your own version, as long as yours stays open source under the same licence, keeps the notices, and has its own name, app ID, update channel and support address (so it isn't mistaken for this app). Bundled Path of Building and the fonts keep their own licences.

## Credits

- Calculations: [Path of Building Community (PoE2)](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2) and [Path of Building Community (PoE1)](https://github.com/PathOfBuildingCommunity/PathOfBuilding) (MIT), bundled unmodified and run headless.
- Fonts: [Alegreya Sans and Alegreya Sans SC](https://github.com/huertatipografica/Alegreya-Sans), under the SIL Open Font License (bundled in `assets/fonts`).
- League start routes: [exile-leveling](https://github.com/HeartofPhos/exile-leveling) by HeartofPhos (PoE1) and [Splitstone](https://github.com/noman-omen/poe2-splitstone) (PoE2), both MIT (see `src/data/routes/LICENSES.md`); the PoE1 optional side quests are written from [poedb](https://poedb.tw)'s quest facts; the PoE1 quest gem rewards and vendors (`poe1-gems.json`) are exile-leveling's gem data.
- Prices: [poe.ninja](https://poe.ninja). Trade data: the official [Path of Exile trade site](https://www.pathofexile.com/trade2).
- Path of Exile is a trademark of Grinding Gear Games. This project isn't affiliated with or endorsed by them.
