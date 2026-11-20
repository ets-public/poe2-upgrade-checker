-- Why trade searches failed (app 0.5.7+): a count per kind per install per day, never the message.
-- Apply with: npx wrangler d1 migrations apply poe-upgrade-stats --remote -c wrangler.site.jsonc
CREATE TABLE IF NOT EXISTS trade_fails (
  day TEXT NOT NULL,
  install TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0,
  complex INTEGER NOT NULL DEFAULT 0,
  server INTEGER NOT NULL DEFAULT 0,
  timeout INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0,
  other INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, install)
);
