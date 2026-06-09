-- Migration 007: per-agency Twilio credentials + regulatory config
--
-- Allows each agency to bring their own Twilio account instead of sharing
-- the platform credentials. The buy/search/link routes fall back to the
-- platform env vars when these columns are null.
--
-- twilio_regulatory stores bundle and address SIDs keyed by country + number
-- type, e.g.:
-- {
--   "GB": {
--     "LOCAL":    { "bundle_sid": "BU...", "address_sid": "AD..." },
--     "MOBILE":   { "bundle_sid": "BU...", "address_sid": "AD..." },
--     "TOLLFREE": { "bundle_sid": null,    "address_sid": null    }
--   },
--   "US": {
--     "LOCAL":    { "bundle_sid": null, "address_sid": "AD..." },
--     "TOLLFREE": { "bundle_sid": null, "address_sid": null    }
--   }
-- }

alter table vb.agencies
  add column if not exists twilio_account_sid  text,
  add column if not exists twilio_auth_token   text,
  add column if not exists twilio_regulatory   jsonb not null default '{}';
