import Stripe from 'stripe';

// Single Stripe client for the server side. Cached so we don't re-construct
// per request. Don't call this from client components — STRIPE_SECRET_KEY
// must never leave the server.

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set on the server.');
  }
  cached = new Stripe(key);
  return cached;
}
