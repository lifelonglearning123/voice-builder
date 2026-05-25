-- =====================================================================
-- AI Voice Bot Builder Platform — initial schema
-- Target: shared Supabase Postgres with Voice Monitor
-- Schema namespace: builder.*  (monitor.* owned by Voice Monitor)
--
-- Conventions:
--   - Multi-tenant via agency_id on every tenant table
--   - RLS policies mirror Voice Monitor's tenant_isolation pattern
--   - Soft updates via updated_at trigger; no soft delete in v1
--   - Bot config stored as a denormalized row + JSONB repeaters
--     (services, FAQs, guardrails, escalation rules) — read-as-a-whole pattern
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS builder;

-- pgvector extension assumed already enabled in Voice Monitor's setup;
-- if not:  CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================================
-- Enums
-- =====================================================================

CREATE TYPE builder.bot_status AS ENUM (
  'draft',
  'live',
  'paused',
  'archived'
);

CREATE TYPE builder.tier AS ENUM (
  'starter',
  'pro',
  'premium'
);

CREATE TYPE builder.crm_status AS ENUM (
  'not_connected',
  'connected',
  'skipped',
  'error'
);

CREATE TYPE builder.out_of_hours_behavior AS ENUM (
  'answer_normally',
  'take_message',
  'reject_politely'
);

CREATE TYPE builder.transfer_fallback AS ENUM (
  'take_message',
  'drop_call'
);

CREATE TYPE builder.knowledge_source_type AS ENUM (
  'document',
  'website',
  'wizard'
);

CREATE TYPE builder.knowledge_doc_status AS ENUM (
  'pending',
  'chunking',
  'indexed',
  'failed'
);

CREATE TYPE builder.crm_push_status AS ENUM (
  'pending',
  'success',
  'skipped',
  'failed'
);

-- =====================================================================
-- bots — canonical bot config (one row per bot)
-- =====================================================================

CREATE TABLE builder.bots (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id                   uuid NOT NULL,    -- FK to monitor.agencies
  client_id                   uuid NOT NULL,    -- FK to monitor.clients

  -- Step 1: Business basics
  internal_name               text NOT NULL,    -- admin-only label
  business_name               text NOT NULL,    -- spoken
  business_address            text,
  industry                    text,             -- enum-ish freetext for now
  language                    text NOT NULL DEFAULT 'en-GB',
  working_hours               jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone                    text NOT NULL DEFAULT 'Europe/London',
  out_of_hours_behavior       builder.out_of_hours_behavior NOT NULL DEFAULT 'take_message',

  -- Step 2: How it sounds
  agent_name                  text NOT NULL,    -- spoken bot name ("Sarah", "Emma")
  voice_id                    text NOT NULL,    -- ElevenLabs voice id (one of the 4 fixed)
  tone_chips                  text[] NOT NULL DEFAULT ARRAY[]::text[],
  opening_line                text NOT NULL,
  conversation_rules          jsonb NOT NULL DEFAULT '{
    "one_question_at_a_time": true,
    "max_sentences_per_response": 2,
    "ai_disclosure_response": "I am a virtual assistant",
    "rotate_phrases_no_repeat_within_turns": 3
  }'::jsonb,
  pronunciation_rules         jsonb NOT NULL DEFAULT '{
    "spell_phone_digit_by_digit": true,
    "spell_email_aloud": true,
    "phonetic_url": true
  }'::jsonb,

  -- Step 3: What it knows (Starter tier — repeaters as JSONB)
  services                    jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{name, description, price?}]
  faqs                        jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{q, a}]
  hard_guardrails             jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- ["Do not give financial advice", ...]
  escalation_rules            jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{trigger, action, detail}]
    -- action in: 'redirect_email' | 'take_message' | 'transfer_number' | 'custom_response'

  -- Step 3: Pro tier (website)
  website_url                 text,
  website_sync_schedule       text,             -- 'off' | 'weekly' | 'monthly'
  last_website_sync_at        timestamptz,

  -- Step 4: Transfer
  transfer_enabled            boolean NOT NULL DEFAULT false,
  transfer_number             text,             -- E.164
  transfer_triggers           text,
  transfer_pre_line           text,
  transfer_fallback           builder.transfer_fallback DEFAULT 'take_message',

  -- Step 5: Safety
  max_call_duration_s         int NOT NULL DEFAULT 600,
  daily_minute_cap            int NOT NULL DEFAULT 200,
  monthly_minute_cap          int,
  alert_recipients            jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{email, channels: ['email', 'whatsapp']}]

  -- Step 6: Phone number (Twilio)
  twilio_phone_sid            text,
  twilio_phone_e164           text,
  twilio_purchased_at         timestamptz,

  -- Step 7: CRM connection (whitelabel: "GHL" never appears in copy)
  crm_status                  builder.crm_status NOT NULL DEFAULT 'not_connected',
  crm_token_encrypted         bytea,            -- pgsodium / Supabase Vault
  crm_location_id             text,
  crm_location_name           text,             -- cached from test connection
  crm_connected_at            timestamptz,
  crm_last_error              text,

  -- Step 8: Booking (only meaningful if crm_status='connected')
  booking_enabled             boolean NOT NULL DEFAULT false,
  booking_calendar_id         text,
  booking_services            jsonb NOT NULL DEFAULT '[]'::jsonb,
  booking_lead_time_minutes   int NOT NULL DEFAULT 120,
  booking_max_future_days     int NOT NULL DEFAULT 30,
  booking_confirmation_message text,
  booking_reschedule_via_bot  boolean NOT NULL DEFAULT false,
  -- G3: booking windows separate from working_hours (NULL = use working_hours;
  -- {} = unrestricted; populated = constrain bookings to these days/hours)
  booking_hours               jsonb,

  -- G4: operator-defined custom in-call tools (e.g. send_sms).
  -- Empty array → no custom tools registered with Retell, nothing in prompt.
  -- [{name, description, trigger, webhook_url, parameters: [{name,type,description,required}]}]
  custom_tools                jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- G5: reason-based conditional capture. Top-level capture_fields apply to
  -- every caller; branch capture_fields apply only when the caller's intent
  -- matches that branch.
  -- [{name, match_keywords: [string], capture_fields: [CaptureField]}]
  reason_branches             jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Step 9: Data capture during call (G1) + verify-before-close (G2)
  capture_fields              jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{name, ask, required, timing: 'early'|'before_action'|'marketing_end'}]
  verify_capture_before_close boolean NOT NULL DEFAULT false,

  -- Step 9: Post-call analysis (extracted by LLM after call)
  post_call_fields            jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- [{name, type: 'text'|'select'|'boolean'|'number', options?, hint, crm_custom_field_id?}]
  save_audio                  boolean NOT NULL DEFAULT true,
  save_transcript             boolean NOT NULL DEFAULT true,
  crm_workflow_id             text,             -- if CRM connected: workflow to trigger
  fallback_email_to           text,             -- if CRM skipped
  fallback_email_template     text,

  -- Retell
  retell_agent_id             text,             -- created on first compile

  -- Tier
  tier                        builder.tier NOT NULL DEFAULT 'starter',

  -- Lifecycle
  status                      builder.bot_status NOT NULL DEFAULT 'draft',
  version                     int NOT NULL DEFAULT 1,
  went_live_at                timestamptz,

  -- Audit
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid REFERENCES auth.users(id),
  last_edited_by              uuid REFERENCES auth.users(id),

  CHECK (transfer_enabled = false OR transfer_number IS NOT NULL),
  CHECK (booking_enabled = false OR (crm_status = 'connected' AND booking_calendar_id IS NOT NULL))
);

CREATE INDEX bots_agency_client_idx ON builder.bots (agency_id, client_id);
CREATE INDEX bots_status_live_idx ON builder.bots (status) WHERE status = 'live';
CREATE INDEX bots_retell_agent_idx ON builder.bots (retell_agent_id) WHERE retell_agent_id IS NOT NULL;
CREATE UNIQUE INDEX bots_twilio_phone_unique ON builder.bots (twilio_phone_e164) WHERE twilio_phone_e164 IS NOT NULL;

-- =====================================================================
-- wizard_drafts — autosave during wizard, separate so it doesn't bloat bots
-- =====================================================================

CREATE TABLE builder.wizard_drafts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id           uuid NOT NULL,
  client_id           uuid NOT NULL,
  bot_id              uuid REFERENCES builder.bots(id) ON DELETE CASCADE,
    -- nullable: drafts created before the bot row exists
  user_id             uuid REFERENCES auth.users(id),

  current_step        int NOT NULL DEFAULT 0,
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- mirrors a subset of builder.bots fields, captures in-progress state

  -- Step 0 inputs (kept for analytics / regeneration)
  describe_input      text,
  describe_industry   text,
  describe_url        text,
  ai_prefill_result   jsonb,
  ai_prefill_model    text,
  ai_prefill_at       timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX wizard_drafts_user_idx ON builder.wizard_drafts (user_id);
CREATE INDEX wizard_drafts_bot_idx ON builder.wizard_drafts (bot_id);

-- =====================================================================
-- bot_versions — full snapshot on every "Go live" (rollback support)
-- =====================================================================

CREATE TABLE builder.bot_versions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                      uuid NOT NULL REFERENCES builder.bots(id) ON DELETE CASCADE,
  agency_id                   uuid NOT NULL,
  version                     int NOT NULL,

  snapshot                    jsonb NOT NULL,
    -- full row from builder.bots at the moment of go-live
  compiled_retell_payload     jsonb NOT NULL,
    -- what was POST/PATCHed to Retell

  went_live_at                timestamptz NOT NULL DEFAULT now(),
  went_live_by                uuid REFERENCES auth.users(id),
  notes                       text,

  UNIQUE (bot_id, version)
);

CREATE INDEX bot_versions_bot_idx ON builder.bot_versions (bot_id, went_live_at DESC);

-- =====================================================================
-- knowledge_documents — Premium tier doc uploads
-- =====================================================================

CREATE TABLE builder.knowledge_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          uuid NOT NULL REFERENCES builder.bots(id) ON DELETE CASCADE,
  agency_id       uuid NOT NULL,

  filename        text NOT NULL,
  r2_key          text NOT NULL,
  mime_type       text,
  size_bytes      bigint,
  status          builder.knowledge_doc_status NOT NULL DEFAULT 'pending',
  error_message   text,

  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  indexed_at      timestamptz,
  uploaded_by     uuid REFERENCES auth.users(id)
);

CREATE INDEX knowledge_documents_bot_idx ON builder.knowledge_documents (bot_id);

-- =====================================================================
-- knowledge_chunks — pgvector chunks for RAG
-- =====================================================================

CREATE TABLE builder.knowledge_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          uuid NOT NULL REFERENCES builder.bots(id) ON DELETE CASCADE,
  document_id     uuid REFERENCES builder.knowledge_documents(id) ON DELETE CASCADE,
  source_type     builder.knowledge_source_type NOT NULL,
  source_ref      text,
    -- doc_id for documents, url for website, 'wizard' for wizard-derived

  chunk_index     int,
  content         text NOT NULL,
  embedding       vector(1536) NOT NULL,
    -- OpenAI text-embedding-3-small

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX knowledge_chunks_bot_idx ON builder.knowledge_chunks (bot_id);
CREATE INDEX knowledge_chunks_embedding_idx ON builder.knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- =====================================================================
-- website_syncs — Pro tier website scrape history
-- =====================================================================

CREATE TABLE builder.website_syncs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                  uuid NOT NULL REFERENCES builder.bots(id) ON DELETE CASCADE,
  agency_id               uuid NOT NULL,

  url                     text NOT NULL,
  status                  text NOT NULL,    -- 'running' | 'success' | 'failed'
  pages_scraped           int,
  summary                 text,
  raw_payload_r2_key      text,
  error_message           text,

  started_at              timestamptz NOT NULL DEFAULT now(),
  finished_at             timestamptz
);

CREATE INDEX website_syncs_bot_idx ON builder.website_syncs (bot_id, started_at DESC);

-- =====================================================================
-- call_records — per-call record, joined to monitor.calls
-- =====================================================================

CREATE TABLE builder.call_records (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id                          uuid NOT NULL REFERENCES builder.bots(id) ON DELETE CASCADE,
  bot_version                     int NOT NULL,
  agency_id                       uuid NOT NULL,
  client_id                       uuid NOT NULL,

  retell_call_id                  text NOT NULL UNIQUE,
  monitor_call_id                 uuid,
    -- FK to monitor.calls; loose because monitor schema is managed separately

  caller_phone                    text,
  caller_name                     text,
  duration_s                      int,
  outcome                         text,
    -- 'booked' | 'transferred' | 'message' | 'info' | 'missed' | 'dropped'

  structured_data                 jsonb,
    -- per-bot post-call fields as extracted by Retell

  transcript_text                 text,
  audio_r2_key                    text,

  crm_push_status                 builder.crm_push_status,
  crm_push_error                  text,
  crm_workflow_triggered_at       timestamptz,
  crm_contact_id                  text,

  fallback_email_sent_at          timestamptz,
  fallback_email_to               text,

  started_at                      timestamptz,
  ended_at                        timestamptz,
  created_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX call_records_bot_started_idx ON builder.call_records (bot_id, started_at DESC);
CREATE INDEX call_records_agency_started_idx ON builder.call_records (agency_id, started_at DESC);
CREATE INDEX call_records_outcome_idx ON builder.call_records (outcome);

-- =====================================================================
-- bot_daily_usage — pre-aggregated daily minutes for cost-cap enforcement
-- =====================================================================

CREATE TABLE builder.bot_daily_usage (
  bot_id              uuid NOT NULL REFERENCES builder.bots(id) ON DELETE CASCADE,
  agency_id           uuid NOT NULL,
  usage_date          date NOT NULL,

  minutes_used        numeric(10,2) NOT NULL DEFAULT 0,
  calls_count         int NOT NULL DEFAULT 0,
  alert_80_fired_at   timestamptz,
  cap_hit_at          timestamptz,

  PRIMARY KEY (bot_id, usage_date)
);

CREATE INDEX bot_daily_usage_agency_date_idx ON builder.bot_daily_usage (agency_id, usage_date);

-- =====================================================================
-- alert_events — audit log of every alert fired
-- =====================================================================

CREATE TABLE builder.alert_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          uuid NOT NULL REFERENCES builder.bots(id) ON DELETE CASCADE,
  agency_id       uuid NOT NULL,

  alert_type      text NOT NULL,
    -- 'cap_80' | 'cap_100' | 'crm_connection_error' | 'twilio_outage' | ...
  message         text,
  metadata        jsonb,

  sent_via        text[] NOT NULL DEFAULT ARRAY[]::text[],
    -- ['email', 'whatsapp']
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_events_bot_idx ON builder.alert_events (bot_id, sent_at DESC);

-- =====================================================================
-- Triggers — updated_at maintenance
-- =====================================================================

CREATE OR REPLACE FUNCTION builder.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bots_updated_at
BEFORE UPDATE ON builder.bots
FOR EACH ROW EXECUTE FUNCTION builder.set_updated_at();

CREATE TRIGGER wizard_drafts_updated_at
BEFORE UPDATE ON builder.wizard_drafts
FOR EACH ROW EXECUTE FUNCTION builder.set_updated_at();

-- =====================================================================
-- RLS — mirror Voice Monitor tenant_isolation pattern
-- Assumes monitor.users(id, agency_id) exists. Adjust the membership
-- subquery if Voice Monitor uses a different mapping (e.g., view or claim).
-- =====================================================================

ALTER TABLE builder.bots                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.wizard_drafts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.bot_versions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.knowledge_documents  ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.knowledge_chunks     ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.website_syncs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.call_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.bot_daily_usage      ENABLE ROW LEVEL SECURITY;
ALTER TABLE builder.alert_events         ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON builder.bots
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON builder.wizard_drafts
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON builder.bot_versions
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON builder.knowledge_documents
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON builder.knowledge_chunks
  FOR ALL TO authenticated
  USING (bot_id IN (
    SELECT id FROM builder.bots
    WHERE agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid())
  ));

CREATE POLICY tenant_isolation ON builder.website_syncs
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON builder.call_records
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON builder.bot_daily_usage
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

CREATE POLICY tenant_isolation ON builder.alert_events
  FOR ALL TO authenticated
  USING (agency_id IN (SELECT agency_id FROM monitor.users WHERE id = auth.uid()));

-- Service role bypasses RLS by default in Supabase, so server-side
-- jobs (cron, Retell webhook handler) continue to work without policy changes.
