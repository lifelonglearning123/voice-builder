-- Voice Builder schema — M1 migration (multi-tenant)
--
-- Runs against the *shared* Voice Monitor Supabase project. Everything
-- Voice-Builder-specific lives under the `vb` schema so it can't collide
-- with Voice Monitor's tables. `auth.users` is shared on purpose.
--
-- The model in one paragraph:
--   Macaws is the platform. Multiple AGENCIES use the platform on a flat
--   monthly subscription billed to Macaws' own Stripe account. Each agency
--   has its own Stripe Connect (Express) account to charge their clients.
--   Each BOT belongs to an agency. Each agency has staff (agency_members),
--   and only those staff can see/manage the agency's bots — RLS enforced.
--
-- HOW TO RUN
--   1. Supabase Dashboard → SQL Editor → "New query".
--   2. Paste this whole file.
--   3. Click "Run".
--   4. Should report "Success. No rows returned."
--   5. AFTER running: Project Settings → API → Exposed schemas → add `vb`.
--   6. Seed your first agency (Macaws) — see the block at the bottom.
--
-- The migration is idempotent — re-running is safe.

-- ---------------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------------

create schema if not exists vb;

-- ---------------------------------------------------------------------------
-- 2. Agencies — one row per white-label customer
-- ---------------------------------------------------------------------------

create table if not exists vb.agencies (
  id                                   uuid primary key default gen_random_uuid(),
  name                                 text not null,
  slug                                 text not null unique,
  -- Each agency brings their own domain — e.g. "voice-builder.acme.com".
  -- Verification happens out-of-band (DNS + SSL) and flips the flag.
  custom_domain                        text unique,
  custom_domain_verified               boolean not null default false,

  -- Branding
  brand_logo_url                       text,
  brand_color                          text,

  -- Platform billing — Macaws charges the agency on Macaws' own Stripe.
  platform_stripe_customer_id          text unique,
  platform_subscription_id             text unique,
  platform_subscription_status         text not null default 'inactive'
    check (platform_subscription_status in (
      'inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'
    )),
  platform_subscription_renews_at      timestamptz,

  -- Stripe Connect (Express) — agency charges their own clients here.
  stripe_connect_account_id            text unique,
  stripe_connect_onboarding_complete   boolean not null default false,

  -- What the agency charges their clients (display-only at this layer; the
  -- actual price is whatever Stripe Price the agency wires up in Connect).
  client_price_pence                   integer,
  client_currency                      text default 'gbp',

  -- The user who created the agency. Membership table determines access.
  owner_user_id                        uuid references auth.users (id) on delete set null,

  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now()
);

create index if not exists vb_agencies_custom_domain_idx
  on vb.agencies (custom_domain) where custom_domain is not null;
create index if not exists vb_agencies_owner_idx
  on vb.agencies (owner_user_id);

-- ---------------------------------------------------------------------------
-- 3. Agency members — many-to-many between users and agencies
-- ---------------------------------------------------------------------------

create table if not exists vb.agency_members (
  agency_id   uuid not null references vb.agencies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'staff'
    check (role in ('owner', 'admin', 'staff')),
  created_at  timestamptz not null default now(),
  primary key (agency_id, user_id)
);

create index if not exists vb_agency_members_user_idx
  on vb.agency_members (user_id);

-- ---------------------------------------------------------------------------
-- 4. Membership helper — used by RLS to avoid recursive checks
-- ---------------------------------------------------------------------------

create or replace function vb.is_agency_member(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = vb, public
as $$
  select exists (
    select 1
    from vb.agency_members
    where agency_id = p_agency_id
      and user_id = auth.uid()
  );
$$;

create or replace function vb.is_agency_admin(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = vb, public
as $$
  select exists (
    select 1
    from vb.agency_members
    where agency_id = p_agency_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- 5. Bots — one row per AI receptionist, scoped to an agency
-- ---------------------------------------------------------------------------

create table if not exists vb.bots (
  id                              uuid primary key default gen_random_uuid(),
  agency_id                       uuid not null references vb.agencies (id) on delete cascade,
  -- The agency staff member who created/owns this bot. Nullable so deleting
  -- a staff member doesn't cascade-delete bots they built.
  user_id                         uuid references auth.users (id) on delete set null,
  -- Whole wizard draft as JSON. Kept as a single jsonb blob because the
  -- wizard's shape evolves rapidly; we don't want a schema migration every
  -- time we add a field. Cost: no SQL queries against individual fields.
  draft                           jsonb not null default '{}'::jsonb,
  status                          text not null default 'draft'
    check (status in ('draft', 'live', 'archived')),
  -- IDs returned from voice service after activation. Null until live.
  agent_id                        text,
  llm_id                          text,
  phone_e164                      text,
  -- Client subscription tracking — the SMB pays the agency via Connect.
  -- subscription_id lives in the agency's Connect account.
  client_stripe_subscription_id   text,
  client_subscription_status      text not null default 'inactive'
    check (client_subscription_status in (
      'inactive', 'trialing', 'active', 'past_due', 'canceled', 'unpaid'
    )),
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

create index if not exists vb_bots_agency_idx     on vb.bots (agency_id);
create index if not exists vb_bots_user_idx       on vb.bots (user_id);
create index if not exists vb_bots_updated_at_idx on vb.bots (updated_at desc);

-- ---------------------------------------------------------------------------
-- 6. updated_at triggers
-- ---------------------------------------------------------------------------

create or replace function vb.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists vb_agencies_touch on vb.agencies;
create trigger vb_agencies_touch
  before update on vb.agencies
  for each row execute function vb.touch_updated_at();

drop trigger if exists vb_bots_touch on vb.bots;
create trigger vb_bots_touch
  before update on vb.bots
  for each row execute function vb.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Row Level Security
-- ---------------------------------------------------------------------------

alter table vb.agencies        enable row level security;
alter table vb.agency_members  enable row level security;
alter table vb.bots            enable row level security;

-- Drop and recreate so re-running is safe.
drop policy if exists vb_agencies_select_member         on vb.agencies;
drop policy if exists vb_agencies_update_admin          on vb.agencies;
drop policy if exists vb_agency_members_select          on vb.agency_members;
drop policy if exists vb_bots_select_member             on vb.bots;
drop policy if exists vb_bots_insert_member             on vb.bots;
drop policy if exists vb_bots_update_member             on vb.bots;
drop policy if exists vb_bots_delete_member             on vb.bots;

-- Agencies: visible to all members; updatable only by owner/admin.
create policy vb_agencies_select_member on vb.agencies
  for select using (vb.is_agency_member(id));
create policy vb_agencies_update_admin on vb.agencies
  for update using (vb.is_agency_admin(id))
  with check (vb.is_agency_admin(id));

-- Members: members of an agency can see who else is in it.
create policy vb_agency_members_select on vb.agency_members
  for select using (vb.is_agency_member(agency_id));

-- Bots: any member of the agency can manage them.
create policy vb_bots_select_member on vb.bots
  for select using (vb.is_agency_member(agency_id));
create policy vb_bots_insert_member on vb.bots
  for insert with check (vb.is_agency_member(agency_id));
create policy vb_bots_update_member on vb.bots
  for update using (vb.is_agency_member(agency_id))
  with check (vb.is_agency_member(agency_id));
create policy vb_bots_delete_member on vb.bots
  for delete using (vb.is_agency_member(agency_id));

-- ---------------------------------------------------------------------------
-- 8. Expose `vb` schema to PostgREST so supabase-js can query it
-- ---------------------------------------------------------------------------

grant usage on schema vb to anon, authenticated, service_role;
grant all on all tables in schema vb to anon, authenticated, service_role;
grant all on all sequences in schema vb to anon, authenticated, service_role;
grant execute on all functions in schema vb to anon, authenticated, service_role;

alter default privileges in schema vb
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema vb
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema vb
  grant execute on functions to anon, authenticated, service_role;

-- IMPORTANT: after running this you must also add `vb` to the Exposed
-- schemas list in the Supabase Dashboard:
--   Project Settings -> API -> Exposed schemas
--   Set to: `public, graphql_public, vb`

-- ---------------------------------------------------------------------------
-- 9. Seed Macaws as the first agency
--    (Run this block separately AFTER you've signed in at least once via
--     the magic-link flow, so that your row exists in auth.users.)
-- ---------------------------------------------------------------------------
/*

insert into vb.agencies (name, slug, custom_domain, custom_domain_verified)
values ('Macaws', 'macaws', 'builder.macaws.ai', true)
on conflict (slug) do nothing;

insert into vb.agency_members (agency_id, user_id, role)
select
  (select id from vb.agencies where slug = 'macaws'),
  (select id from auth.users where email = 'chao@macaws.ai'),
  'owner'
on conflict (agency_id, user_id) do nothing;

*/
