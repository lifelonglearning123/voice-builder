# Schema

Postgres DDL for the AI Voice Bot Builder. Target: the **shared Supabase** used by Voice Monitor.

## Files

- `001_init.sql` — full initial schema (`builder.*` namespace)

## Conventions

- **Namespace.** All tables live under `builder.*`. Voice Monitor owns `monitor.*`. No cross-schema FKs are enforced in the DDL (loose references) so the two apps can be migrated independently — the RLS policies are the only cross-schema dependency.
- **Tenancy.** Every tenant table has `agency_id`. RLS policies mirror Voice Monitor's `tenant_isolation` pattern, gated on `monitor.users`. **Adjust the subquery** in the RLS policies if Voice Monitor's user-to-agency mapping differs (e.g. lives in a view, JWT claim, or a different table).
- **Drizzle ownership.** This SQL is hand-authored for the v1 schema review. Once approved, convert to Drizzle definitions in `db/schema/builder.ts` so Drizzle owns generation. Keep `monitor.*` strictly out of this Drizzle config — Voice Monitor owns those.
- **Repeaters as JSONB.** Services, FAQs, hard guardrails, escalation rules, post-call fields, alert recipients — all stored as JSONB arrays on `builder.bots`. The bot config is read as a whole by the wizard and the `compileBot()` function, so denormalisation wins.
- **Things kept in own tables.** Wizard autosave (`wizard_drafts`), version history (`bot_versions`), knowledge docs (`knowledge_documents` + `knowledge_chunks`), website sync history (`website_syncs`), call records (`call_records`), daily usage aggregates (`bot_daily_usage`), alert audit (`alert_events`).

## Open decisions before applying

1. **Cross-schema FK** to `monitor.agencies(id)` / `monitor.clients(id)` — kept loose (no FK declared) so Drizzle migrations on each side don't fight. Confirm this is OK with Voice Monitor's current migration tooling, or tighten to real FKs if both apps are deployed in lockstep.
2. **Encryption.** `crm_token_encrypted bytea` is a placeholder. Decide: Supabase Vault (preferred, opaque), or pgsodium with a keyring (manual), or app-side AES with a key in env (worst).
3. **pgvector index lists = 100** in `001_init.sql` — fine for ≤100k chunks. Re-tune (or switch to HNSW) once usage data exists.
4. **Outcome enum** on `call_records.outcome` — kept as text rather than enum because it'll evolve faster than DDL. Promote to enum if it stabilises.
5. **Service role webhook handlers.** Retell webhook + Twilio webhook + Vercel cron run as Supabase service role — these bypass RLS, which is intentional. Confirm Voice Monitor uses the same pattern.

## Next steps

1. Run `001_init.sql` against a Supabase **staging branch** (not prod) and verify the RLS subqueries against `monitor.users` resolve correctly.
2. Generate Drizzle definitions from this schema and check them into `db/schema/builder.ts`.
3. Write a `compileBot(bot: Bot): RetellAgentPayload` function and unit-test it against the 4 reference prompts in `reference_prompts/`.
