// Regional copy for the public marketing pages.
//
// Each Voice Builder agency runs on its own Vercel deployment with a
// `MARKETING_COUNTRY` env var declaring which region they're targeting
// (see lib/agency/marketing.ts for the resolution). The marketing pages
// then look up a record here and substitute the variable strings —
// country adjective, voice language, industry example, area code cities,
// competing-service prices, etc. — so a US-targeted deployment doesn't
// talk about "British plumbers" and a UK deployment doesn't quote
// "$1,800/mo for a receptionist".
//
// Adding a new region: append a `RegionalCopy` record below, keyed by
// its ISO-3166 alpha-2 code, then add the code to `SUPPORTED_REGIONS`.
// Default fallback is GB.

export type RegionCode = 'GB' | 'US' | 'CA' | 'AU' | 'IE' | 'NZ';

export interface RegionalCopy {
  /** Adjective form of the country: "UK", "US", "Canadian", etc. Used
   *  in phrases like "a dedicated {countryAdj} phone number" and "the
   *  average {countryAdj} SMB". */
  countryAdj: string;
  /** Language label for voices: "UK English", "US English". */
  voiceLanguage: string;
  /** Full sentence excluding foreign accents, e.g. "No American accents
   *  on British plumbers." — used at the end of voice copy. */
  accentExclusion: string;
  /** Comma-separated city list for area-code examples. */
  areaCodeCities: string;
  /** Two place names to ground the "callers from X or Y" sentence. */
  callerLocale: string;
  /** Concrete industry example used in the homepage hero copy. */
  industry: {
    /** Service name in lowercase, e.g. "boiler service", "HVAC service call". */
    service: string;
    /** Price formatted with local currency symbol, e.g. "£180". */
    priceLabel: string;
    /** Plural profession for the accent-exclusion sentence and other
     *  industry references, e.g. "plumbers", "contractors". */
    profession: string;
  };
  /** Approximate market prices for competing options. Used in the
   *  "compared with the alternatives" table on the pricing page. */
  comparePrices: {
    liveReceptionist: string;
    answeringService: string;
    voicemail: string;
  };
  /** Short line printed under the headline price on the pricing card,
   *  e.g. "Includes VAT." or "" if nothing useful to say. */
  taxLine: string;
  /** Concrete examples for the "Describe your business" / "Get a phone
   *  number" wizard mockups on the how-it-works page. Region-realistic so
   *  US visitors don't see a `+44` number in the demo screenshot. */
  mockup: {
    /** Two-sentence SMB description used in the describe-step mock card. */
    describeBody: string;
    /** Realistic example website domain matching the local TLD. */
    websiteDomain: string;
    /** Display-formatted local phone number, including country dial-code. */
    phoneNumber: string;
    /** Short geo label for the number, e.g. "London local". */
    phoneCityLabel: string;
  };
  /** Placeholder shown in the wizard's "Tell us about your business"
   *  textarea — gives users a region-appropriate template to start from
   *  instead of being asked to imagine an SMB cold. */
  wizardSamplePlaceholder: string;
}

export const REGIONAL_COPY: Record<RegionCode, RegionalCopy> = {
  GB: {
    countryAdj: 'UK',
    voiceLanguage: 'UK English',
    accentExclusion: 'No American accents on British plumbers.',
    areaCodeCities: 'London, Manchester, Birmingham',
    callerLocale: 'Stoke or Stockport',
    industry: {
      service: 'boiler service',
      priceLabel: '£180',
      profession: 'plumbers',
    },
    comparePrices: {
      liveReceptionist: '£900+',
      answeringService: '£250–£600',
      voicemail: '£0',
    },
    taxLine: 'Includes VAT.',
    mockup: {
      describeBody:
        "We're a family-run plumbing firm in north London. We do emergency call-outs, boiler servicing, and bathroom installs. Calls go to my mobile right now but I'm missing half of them.",
      websiteDomain: 'acme-plumbing.co.uk',
      phoneNumber: '+44 20 4587 9020',
      phoneCityLabel: 'London local',
    },
    wizardSamplePlaceholder: `I run a dental practice in Manchester. The receptionist is called Sarah. She books cleanings on our calendar (Mon-Fri 9-5), answers FAQs about price, parking, and opening hours, and takes a detailed message for anything she can't handle.

Always capture name, phone, and email before booking. Never give medical advice.`,
  },
  US: {
    countryAdj: 'US',
    voiceLanguage: 'US English',
    accentExclusion: 'No British accents on US contractors.',
    areaCodeCities: 'New York, Los Angeles, Chicago',
    callerLocale: 'Boise or Boston',
    industry: {
      service: 'HVAC service call',
      priceLabel: '$180',
      profession: 'contractors',
    },
    comparePrices: {
      liveReceptionist: '$1,800+',
      answeringService: '$200–$600',
      voicemail: '$0',
    },
    taxLine: '',
    mockup: {
      describeBody:
        "We're a family-run HVAC contractor in Chicago. We do emergency service calls, furnace tune-ups, and AC installs. Calls go to my cell right now but I'm missing half of them.",
      websiteDomain: 'acme-hvac.com',
      phoneNumber: '+1 (312) 555 0182',
      phoneCityLabel: 'Chicago local',
    },
    wizardSamplePlaceholder: `I run a dental practice in Chicago. The receptionist is called Sarah. She books cleanings on our calendar (Mon-Fri 9-5), answers FAQs about price, parking, and opening hours, and takes a detailed message for anything she can't handle.

Always capture name, phone, and email before booking. Never give medical advice.`,
  },
  CA: {
    countryAdj: 'Canadian',
    voiceLanguage: 'Canadian English',
    accentExclusion: 'No British accents on Canadian contractors.',
    areaCodeCities: 'Toronto, Vancouver, Montreal',
    callerLocale: 'Halifax or Hamilton',
    industry: {
      service: 'furnace service',
      priceLabel: 'CA$180',
      profession: 'contractors',
    },
    comparePrices: {
      liveReceptionist: 'CA$1,500+',
      answeringService: 'CA$250–$700',
      voicemail: 'CA$0',
    },
    taxLine: 'GST/HST charged at checkout.',
    mockup: {
      describeBody:
        "We're a family-run furnace service company in Toronto. We do emergency call-outs, annual tune-ups, and full furnace installs. Calls go to my cell right now but I'm missing half of them.",
      websiteDomain: 'acme-furnace.ca',
      phoneNumber: '+1 (416) 555 0182',
      phoneCityLabel: 'Toronto local',
    },
    wizardSamplePlaceholder: `I run a dental practice in Toronto. The receptionist is called Sarah. She books cleanings on our calendar (Mon-Fri 9-5), answers FAQs about price, parking, and opening hours, and takes a detailed message for anything she can't handle.

Always capture name, phone, and email before booking. Never give medical advice.`,
  },
  AU: {
    countryAdj: 'Australian',
    voiceLanguage: 'Australian English',
    accentExclusion: 'No British accents on Aussie tradies.',
    areaCodeCities: 'Sydney, Melbourne, Brisbane',
    callerLocale: 'Perth or Hobart',
    industry: {
      service: 'plumbing call-out',
      priceLabel: 'A$200',
      profession: 'tradies',
    },
    comparePrices: {
      liveReceptionist: 'A$2,000+',
      answeringService: 'A$300–$800',
      voicemail: 'A$0',
    },
    taxLine: 'Includes 10% GST.',
    mockup: {
      describeBody:
        "We're a family-run plumbing firm in inner-west Sydney. We do emergency call-outs, hot-water system replacements, and bathroom renos. Calls go to my mobile right now but I'm missing half of them.",
      websiteDomain: 'acme-plumbing.com.au',
      phoneNumber: '+61 2 5550 1820',
      phoneCityLabel: 'Sydney local',
    },
    wizardSamplePlaceholder: `I run a dental practice in Sydney. The receptionist is called Sarah. She books cleanings on our calendar (Mon-Fri 9-5), answers FAQs about price, parking, and opening hours, and takes a detailed message for anything she can't handle.

Always capture name, phone, and email before booking. Never give medical advice.`,
  },
  IE: {
    countryAdj: 'Irish',
    voiceLanguage: 'Irish English',
    accentExclusion: 'No American accents on Irish plumbers.',
    areaCodeCities: 'Dublin, Cork, Galway',
    callerLocale: 'Limerick or Waterford',
    industry: {
      service: 'boiler service',
      priceLabel: '€180',
      profession: 'plumbers',
    },
    comparePrices: {
      liveReceptionist: '€1,500+',
      answeringService: '€250–€600',
      voicemail: '€0',
    },
    taxLine: 'Includes VAT at 23%.',
    mockup: {
      describeBody:
        "We're a family-run plumbing firm in north Dublin. We do emergency call-outs, boiler servicing, and bathroom installs. Calls go to my mobile right now but I'm missing half of them.",
      websiteDomain: 'acme-plumbing.ie',
      phoneNumber: '+353 1 555 0182',
      phoneCityLabel: 'Dublin local',
    },
    wizardSamplePlaceholder: `I run a dental practice in Dublin. The receptionist is called Sarah. She books cleanings on our calendar (Mon-Fri 9-5), answers FAQs about price, parking, and opening hours, and takes a detailed message for anything she can't handle.

Always capture name, phone, and email before booking. Never give medical advice.`,
  },
  NZ: {
    countryAdj: 'NZ',
    voiceLanguage: 'New Zealand English',
    accentExclusion: 'No American accents on Kiwi tradies.',
    areaCodeCities: 'Auckland, Wellington, Christchurch',
    callerLocale: 'Dunedin or Hamilton',
    industry: {
      service: 'sparkie call-out',
      priceLabel: 'NZ$180',
      profession: 'tradies',
    },
    comparePrices: {
      liveReceptionist: 'NZ$1,400+',
      answeringService: 'NZ$280–$700',
      voicemail: 'NZ$0',
    },
    taxLine: 'Includes 15% GST.',
    mockup: {
      describeBody:
        "We're a family-run sparkie in Auckland. We do residential rewires, fault-finding call-outs, and switchboard upgrades. Calls go to my mobile right now but I'm missing half of them.",
      websiteDomain: 'acme-electric.co.nz',
      phoneNumber: '+64 9 555 0182',
      phoneCityLabel: 'Auckland local',
    },
    wizardSamplePlaceholder: `I run a dental practice in Auckland. The receptionist is called Sarah. She books cleanings on our calendar (Mon-Fri 9-5), answers FAQs about price, parking, and opening hours, and takes a detailed message for anything she can't handle.

Always capture name, phone, and email before booking. Never give medical advice.`,
  },
};

const SUPPORTED_REGIONS: ReadonlySet<RegionCode> = new Set(
  Object.keys(REGIONAL_COPY) as RegionCode[],
);

/** Coerce an arbitrary string into a supported region code, falling
 *  back to GB. Used to validate the MARKETING_COUNTRY env var so a typo
 *  doesn't crash the marketing pages — it just renders UK copy. */
export function resolveRegion(input: string | null | undefined): RegionCode {
  if (!input) return 'GB';
  const upper = input.trim().toUpperCase();
  return SUPPORTED_REGIONS.has(upper as RegionCode) ? (upper as RegionCode) : 'GB';
}

export function getRegionalCopy(region: RegionCode): RegionalCopy {
  return REGIONAL_COPY[region];
}

/** Read the deployment's marketing region from the env. Works from both
 *  server and client components — we use NEXT_PUBLIC_MARKETING_COUNTRY so
 *  the value is inlined into the client bundle (no secret risk; it's just
 *  a country code). Server-side imports can also use this. */
export function getRegionFromEnv(): RegionCode {
  return resolveRegion(process.env.NEXT_PUBLIC_MARKETING_COUNTRY);
}
