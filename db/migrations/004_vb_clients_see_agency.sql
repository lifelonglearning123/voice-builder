-- Voice Builder schema fix: SMB clients need to read their own agency's row
--
-- Originally, only agency *staff* (vb.agency_members) could read vb.agencies
-- rows under RLS. SMB *clients* (vb.agency_clients) couldn't, which meant
-- the dashboard's join from agency_clients → agencies returned null for the
-- agency, and clients ended up rendering as "no agency" even though their
-- membership row existed.
--
-- This adds a second SELECT policy: clients can read the agency they're a
-- client of. The existing staff policy remains and Postgres ORs them.
--
-- Idempotent — re-running is safe.

drop policy if exists vb_agencies_select_client on vb.agencies;
create policy vb_agencies_select_client on vb.agencies
  for select using (vb.is_agency_client(id));
