-- Voice Builder schema — M1 follow-up: SMB clients (Model B)
--
-- Earlier we assumed agency staff would build bots on behalf of clients.
-- We've switched to true white-label SaaS: SMBs sign up under the agency's
-- branded URL, build their own bots via the wizard, and pay the agency
-- (via Stripe Connect) at activation.
--
-- Two distinct user types now:
--   - Agency staff   → vb.agency_members  (existing, role: owner/admin/staff)
--   - SMB clients    → vb.agency_clients  (NEW)
--
-- A bot belongs to an agency (vb.bots.agency_id) and is owned by an SMB
-- (vb.bots.owner_user_id). Agency staff can see all bots in their agency
-- for portfolio/support purposes; SMB clients can only see their own.
--
-- HOW TO RUN
--   1. Supabase Dashboard → SQL Editor → "New query".
--   2. Paste this whole file.
--   3. Click "Run". Should report "Success. No rows returned."
--
-- Idempotent — re-running is safe.

-- ---------------------------------------------------------------------------
-- 1. SMB client membership table
-- ---------------------------------------------------------------------------

create table if not exists vb.agency_clients (
  agency_id    uuid not null references vb.agencies (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (agency_id, user_id)
);

create index if not exists vb_agency_clients_user_idx
  on vb.agency_clients (user_id);

-- ---------------------------------------------------------------------------
-- 2. Membership helper for SMB clients
-- ---------------------------------------------------------------------------

create or replace function vb.is_agency_client(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = vb, public
as $$
  select exists (
    select 1
    from vb.agency_clients
    where agency_id = p_agency_id
      and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- 3. Add bot owner column
-- ---------------------------------------------------------------------------
-- The SMB who owns this receptionist. Distinct from `user_id`, which records
-- who *created* the row (typically the same as owner, but agency staff could
-- create on behalf in future).

alter table vb.bots
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

create index if not exists vb_bots_owner_idx on vb.bots (owner_user_id);

-- ---------------------------------------------------------------------------
-- 4. Replace RLS policies on vb.bots — staff OR owner can access
-- ---------------------------------------------------------------------------

drop policy if exists vb_bots_select_member  on vb.bots;
drop policy if exists vb_bots_insert_member  on vb.bots;
drop policy if exists vb_bots_update_member  on vb.bots;
drop policy if exists vb_bots_delete_member  on vb.bots;

-- SELECT: agency staff (any role) OR the owning SMB.
create policy vb_bots_select on vb.bots
  for select using (
    vb.is_agency_member(agency_id)
    or auth.uid() = owner_user_id
  );

-- INSERT: either agency staff creating for a client, OR an SMB client of the
-- agency creating their own bot (owner_user_id must be themselves).
create policy vb_bots_insert on vb.bots
  for insert with check (
    vb.is_agency_member(agency_id)
    or (
      auth.uid() = owner_user_id
      and vb.is_agency_client(agency_id)
    )
  );

-- UPDATE: agency staff anywhere in the agency OR the owning SMB.
create policy vb_bots_update on vb.bots
  for update using (
    vb.is_agency_member(agency_id)
    or auth.uid() = owner_user_id
  )
  with check (
    vb.is_agency_member(agency_id)
    or auth.uid() = owner_user_id
  );

-- DELETE: agency staff only (clients can't delete their own bot — has to
-- be archived via support).
create policy vb_bots_delete on vb.bots
  for delete using (vb.is_agency_member(agency_id));

-- ---------------------------------------------------------------------------
-- 5. RLS for vb.agency_clients
-- ---------------------------------------------------------------------------

alter table vb.agency_clients enable row level security;

drop policy if exists vb_agency_clients_select_self on vb.agency_clients;
drop policy if exists vb_agency_clients_select_staff on vb.agency_clients;

-- The client themselves can see their own membership row.
create policy vb_agency_clients_select_self on vb.agency_clients
  for select using (auth.uid() = user_id);

-- Agency staff can see all client rows for their agency (portfolio view).
create policy vb_agency_clients_select_staff on vb.agency_clients
  for select using (vb.is_agency_member(agency_id));

-- INSERT/DELETE happens server-side via the service-role client during
-- signup auto-provisioning, so no client-facing INSERT/DELETE policies.

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------

grant usage on schema vb to anon, authenticated, service_role;
grant all on vb.agency_clients to anon, authenticated, service_role;
grant execute on function vb.is_agency_client(uuid) to anon, authenticated, service_role;
