-- Migration 008: per-agency Stripe Connect country
--
-- Stripe Connect Express accounts are immutably tied to a country at create
-- time — it dictates which payment methods, payout rails and KYC documents
-- the agency owner is asked for during onboarding. Up to now we hardcoded
-- 'GB' which silently broke onboarding for any non-UK agency: they hit
-- Stripe's "not available in your country" wall and gave up.
--
-- This adds a per-agency column, ISO-3166 alpha-2 (e.g. 'GB', 'US', 'CA').
-- Defaulting to 'GB' preserves behaviour for existing rows. The settings UI
-- exposes the picker only while stripe_connect_account_id is still null —
-- once an account exists, Stripe won't let you change country.

alter table vb.agencies
  add column if not exists stripe_country text not null default 'GB';
