// ISO-3166 alpha-2 country code → ITU calling code + display label.
//
// Used by the signup form's phone input to build E.164 numbers. We keep
// this list aligned with the Stripe Connect supported-country allowlist
// (app/api/stripe/connect/start/route.ts and app/dashboard/settings/page.tsx)
// — those are the regions our agencies are actually doing business in, so
// the SMBs they sign up are concentrated there too. UK first since that's
// the dominant default today; the rest sorted alphabetically by label so
// users can scan to their country quickly.

export interface Country {
  /** ISO-3166 alpha-2 (uppercase). */
  code: string;
  /** ITU E.164 calling code, no leading +. */
  callingCode: string;
  /** Human label for the dropdown. */
  label: string;
}

export const COUNTRIES: Country[] = [
  { code: 'GB', callingCode: '44',  label: 'United Kingdom' },
  { code: 'US', callingCode: '1',   label: 'United States' },
  { code: 'CA', callingCode: '1',   label: 'Canada' },
  { code: 'AU', callingCode: '61',  label: 'Australia' },
  { code: 'IE', callingCode: '353', label: 'Ireland' },
  { code: 'NZ', callingCode: '64',  label: 'New Zealand' },
  { code: 'AT', callingCode: '43',  label: 'Austria' },
  { code: 'BE', callingCode: '32',  label: 'Belgium' },
  { code: 'BG', callingCode: '359', label: 'Bulgaria' },
  { code: 'CH', callingCode: '41',  label: 'Switzerland' },
  { code: 'CY', callingCode: '357', label: 'Cyprus' },
  { code: 'CZ', callingCode: '420', label: 'Czechia' },
  { code: 'DE', callingCode: '49',  label: 'Germany' },
  { code: 'DK', callingCode: '45',  label: 'Denmark' },
  { code: 'EE', callingCode: '372', label: 'Estonia' },
  { code: 'ES', callingCode: '34',  label: 'Spain' },
  { code: 'FI', callingCode: '358', label: 'Finland' },
  { code: 'FR', callingCode: '33',  label: 'France' },
  { code: 'GR', callingCode: '30',  label: 'Greece' },
  { code: 'HK', callingCode: '852', label: 'Hong Kong' },
  { code: 'HR', callingCode: '385', label: 'Croatia' },
  { code: 'HU', callingCode: '36',  label: 'Hungary' },
  { code: 'IT', callingCode: '39',  label: 'Italy' },
  { code: 'JP', callingCode: '81',  label: 'Japan' },
  { code: 'LT', callingCode: '370', label: 'Lithuania' },
  { code: 'LU', callingCode: '352', label: 'Luxembourg' },
  { code: 'LV', callingCode: '371', label: 'Latvia' },
  { code: 'MT', callingCode: '356', label: 'Malta' },
  { code: 'MX', callingCode: '52',  label: 'Mexico' },
  { code: 'NL', callingCode: '31',  label: 'Netherlands' },
  { code: 'NO', callingCode: '47',  label: 'Norway' },
  { code: 'PL', callingCode: '48',  label: 'Poland' },
  { code: 'PT', callingCode: '351', label: 'Portugal' },
  { code: 'RO', callingCode: '40',  label: 'Romania' },
  { code: 'SE', callingCode: '46',  label: 'Sweden' },
  { code: 'SG', callingCode: '65',  label: 'Singapore' },
  { code: 'SI', callingCode: '386', label: 'Slovenia' },
  { code: 'SK', callingCode: '421', label: 'Slovakia' },
];

const COUNTRY_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function getCountry(code: string): Country | undefined {
  return COUNTRY_BY_CODE.get(code.toUpperCase());
}

/** Build an E.164 phone string from a country and a user-typed national
 *  number. Strips every non-digit, prepends `+<callingCode>`. Trailing
 *  zero national-trunk prefix common in the UK / NZ etc. is also dropped:
 *  users type "07700 900123" and we want "+447700900123", not
 *  "+4407700900123". A leading 0 in the digits-only national part is
 *  always a trunk prefix in the countries we support — none of them have
 *  legitimate subscriber numbers that start with 0 in E.164.
 *
 *  Returns `null` if the result isn't a plausible E.164 number (too few
 *  digits, suspicious shape). Callers should validate before submission. */
export function toE164(countryCode: string, nationalInput: string): string | null {
  const country = getCountry(countryCode);
  if (!country) return null;
  let digits = nationalInput.replace(/\D+/g, '');
  // Strip a leading trunk-prefix zero (UK, FR, NZ etc.).
  if (digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  if (!digits) return null;
  const e164 = `+${country.callingCode}${digits}`;
  // E.164 max length is 15 digits including calling code. Minimum is
  // squishier — but anything under 7 total digits is almost certainly
  // mistyped, not a real subscriber number.
  const totalDigits = country.callingCode.length + digits.length;
  if (totalDigits < 7 || totalDigits > 15) return null;
  return e164;
}
