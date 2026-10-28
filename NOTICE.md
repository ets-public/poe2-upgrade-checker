# PoE Upgrade Checker: licence notice

Copyright (C) 2025-2026 the PoE Upgrade Checker authors (github.com/ets-public) and contributors.

PoE Upgrade Checker is free software: you can redistribute it and/or modify it under the terms of
the GNU General Public License as published by the Free Software Foundation, version 3 of the
License (the full text is in [LICENSE](LICENSE)), with the additional terms below.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
General Public License for more details.

## What this means in plain words

You may fork, change and share this app, including versions you build and release yourself, as
long as:

- what you share stays **open source under the same licence** (GPL-3.0), with its full source
  code available to everyone who gets your version;
- you **keep this notice and the LICENSE file**, and say what you changed;
- your version **doesn't pass itself off as this app** (see the additional terms).

You don't need to ask first. Pull requests to this repository are welcome too.

## Additional terms (GNU GPL version 3, section 7)

These terms are added under section 7 of the licence and apply to this program and to every
modified version of it.

1. **Marking modified versions (section 7(c)).** A modified version you distribute must be clearly
   marked as different from the original. It must not be presented as PoE Upgrade Checker or as an
   official release of it. That includes:
   - giving it a name that doesn't use or imitate "PoE Upgrade Checker";
   - giving it its own application ID (`build.appId` in package.json), so it doesn't install over,
     or update as, the original;
   - pointing its updates, downloads, support address and issue links at your own repository or
     address, not at this project's (github.com/ets-public/poe2-upgrade-checker,
     poe2upgrade.com, support@poe2upgrade.com).

   Saying that your version is "based on PoE Upgrade Checker", with a link to this repository, is
   allowed and appreciated.

2. **Names and marks (section 7(e)).** This licence grants no rights under trademark law to the
   name "PoE Upgrade Checker", its logo and icon, or the poe2upgrade.com domain and its services.

3. **Preserving notices (section 7(b)).** The copyright and licence notices in the source files,
   in this file and in the app's About and Credits text must be kept in modified versions.

## Parts that are not covered by this licence

- **Path of Building** (vendor/pob, vendor/pob1): the Path of Building Community projects, MIT
  licence, kept with their own LICENSE.md.
- **League start route data** (src/data/routes): the routes come from exile-leveling by HeartofPhos
  (PoE1) and Splitstone by its contributors (PoE2), both MIT licence; their notices are in
  src/data/routes/LICENSES.md.
- **Fonts** Alegreya Sans and Alegreya Sans SC (assets/fonts, site/fonts): SIL Open Font License.
- **Electron, electron-updater** and other npm packages: their own licences (mostly MIT).
- **Path of Exile game data** (passive tree data, item and mod names, art referenced from the
  trade site): the property of Grinding Gear Games, used for a fan-made tool. This project is not
  affiliated with or endorsed by Grinding Gear Games.

## Contributions

By sending a pull request you agree that your contribution is licensed under these same terms
(GPL-3.0 with the additional terms above).
