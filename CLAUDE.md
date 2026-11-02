# Working on PoE Upgrade Checker

Adam tests and ships from his Windows PC (`C:\Users\Adam\ClaudeProjects\poe2-upgrade-checker`). The `.bat` files at the repo root are the workflow; read them before saying a change is ready.

| Script | What it does |
|---|---|
| `test-build.bat` | Builds a portable test .exe **from the local folder**, runs the tests and starts it. It does **not** pull from GitHub. |
| `deploy-site.bat` | Publishes `site/` to poe2upgrade.com (Cloudflare Worker). Merging doesn't deploy the site. |
| `release-beta.bat` / `release.bat` | Tag and publish a GitHub (pre-)release; GitHub Actions builds the installer. Only when Adam asks. |
| `start.bat` | Runs the app from source with Electron. |

## Done means all of this

For every user-facing change, before calling it done:

1. **Tests:** `npm test` passes, and new logic in `src/core` has a test in `test/`.
2. **CHANGELOG.md:** an entry under `## Unreleased` (it also feeds the in-app *What's new*).
3. **README.md:** the Features list, and *Fair play and privacy* if the change reads or writes anything new (files, game folder, network).
4. **Website (`site/index.html`):** the feature cards in `#features`, the JSON-LD `featureList`, and the fair-play box when it applies. New pages go in the nav, the footer and `sitemap.xml`.
5. **Packaging:** new files outside `src/**` and `assets/**` (for example `pob/*.lua`) are added to `build.files` or `extraResources` in package.json.
6. **After the merge:**
   - Bring Adam's PC copy up to date with the merged main, using Remote Control on the folder above. test-build.bat builds whatever is there. If it has uncommitted changes, ask him before pulling, and keep them on a backup branch.
   - Then tell him to run `test-build.bat`.
   - If `site/` changed, tell him to run `deploy-site.bat`.
7. **Tell him where to find it:** the menu, button or hotkey he uses to open the new feature.

## Rules that don't change

- Fair play: the app's only input to the game is one Ctrl+C per hotkey press. Anything else (search strings, chat commands) goes on the clipboard for the player to paste.
- Design tokens are in `DESIGN.md` and `src/ui/css/`. Don't add new hex colours in components.
