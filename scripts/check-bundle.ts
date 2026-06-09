// Usage: node --experimental-strip-types scripts/check-bundle.ts
// Checks the Twilio regulatory bundles and shows what number types each covers.

import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* rely on existing process.env */ }
}

loadEnv();

const sid = process.env.TWILIO_ACCOUNT_SID;
const token = process.env.TWILIO_AUTH_TOKEN;
if (!sid || !token) {
  console.error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN in .env.local');
  process.exit(1);
}

function basicAuth(s: string, t: string) {
  return `Basic ${Buffer.from(`${s}:${t}`).toString('base64')}`;
}

async function fetchTwilio(path: string) {
  const res = await fetch(`https://numbers.twilio.com/v2${path}`, {
    headers: { Authorization: basicAuth(sid!, token!) },
  });
  return res.json();
}

async function main() {
  // List all regulatory bundles
  const data = await fetchTwilio('/RegulatoryCompliance/Bundles?PageSize=50') as {
    results?: Array<{
      sid: string;
      friendly_name: string;
      status: string;
      regulation_sid: string;
      iso_country: string;
      end_user_type: string;
      number_type: string;
    }>;
  };

  if (!data.results) {
    console.error('Unexpected response:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(`\nFound ${data.results.length} regulatory bundle(s):\n`);

  const envBundleSid = process.env.TWILIO_DEFAULT_BUNDLE_SID_GB;

  for (const b of data.results) {
    const isCurrent = b.sid === envBundleSid ? ' ← TWILIO_DEFAULT_BUNDLE_SID_GB' : '';
    console.log(`  ${b.sid}${isCurrent}`);
    console.log(`    Name:        ${b.friendly_name}`);
    console.log(`    Status:      ${b.status}`);
    console.log(`    Country:     ${b.iso_country}`);
    console.log(`    Number type: ${b.number_type}`);
    console.log(`    End user:    ${b.end_user_type}`);
    console.log('');
  }

  console.log('--- Env var summary ---');
  console.log(`TWILIO_DEFAULT_BUNDLE_SID_GB=${process.env.TWILIO_DEFAULT_BUNDLE_SID_GB || '(not set)'}`);
  console.log(`TWILIO_DEFAULT_BUNDLE_SID_GB_LOCAL=${process.env.TWILIO_DEFAULT_BUNDLE_SID_GB_LOCAL || '(not set)'}`);
  console.log(`TWILIO_DEFAULT_BUNDLE_SID_GB_MOBILE=${process.env.TWILIO_DEFAULT_BUNDLE_SID_GB_MOBILE || '(not set)'}`);
  console.log(`TWILIO_DEFAULT_BUNDLE_SID_GB_TOLLFREE=${process.env.TWILIO_DEFAULT_BUNDLE_SID_GB_TOLLFREE || '(not set)'}`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
