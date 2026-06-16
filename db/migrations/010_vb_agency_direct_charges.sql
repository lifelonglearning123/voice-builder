-- Migration 010: per-agency feature flag for Stripe Connect direct charges
--
-- We're moving from destination charges (platform charges the customer,
-- transfers funds to the connected account, platform eats the Stripe fee
-- and is on the hook for refunds) to direct charges (customer's card is
-- processed on the connected account, the connected account pays the
-- Stripe fee and absorbs refunds naturally). See docs / discussion for
-- the architectural rationale.
--
-- The rollout is gated per-agency because the change is invasive: it
-- affects how Checkout, the Customer Portal, webhooks and coupons all
-- behave. New agencies will default to direct charges (flipped by app
-- code after Connect onboarding completes); existing agencies stay on
-- destination charges until explicitly flipped, so their already-live
-- subscriptions keep working.
--
-- Idempotent — re-running is safe.

alter table vb.agencies
  add column if not exists use_direct_charges boolean not null default false;
