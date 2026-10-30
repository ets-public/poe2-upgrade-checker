-- What's used, how far it's set up and problems (app 0.5.3+), and the website's page views and
-- Download clicks. Only numbers and yes/no per install per day; a count per page per day.
-- Apply with: npx wrangler d1 migrations apply poe-upgrade-stats --remote -c wrangler.site.jsonc
CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,
  install TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0,
  prices INTEGER NOT NULL DEFAULT 0,
  searches INTEGER NOT NULL DEFAULT 0,
  route INTEGER NOT NULL DEFAULT 0,
  s_guide INTEGER NOT NULL DEFAULT 0,
  s_build INTEGER NOT NULL DEFAULT 0,
  s_gear INTEGER NOT NULL DEFAULT 0,
  s_checked INTEGER NOT NULL DEFAULT 0,
  e_hotkey INTEGER NOT NULL DEFAULT 0,
  e_pob INTEGER NOT NULL DEFAULT 0,
  e_trade INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, install)
);
CREATE TABLE IF NOT EXISTS visits (
  day TEXT NOT NULL,
  page TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, page)
);
