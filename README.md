# Voice Builder

White-label AI voice bot builder. Scoping phase. Status: schema drafted, compile function drafted, no UI yet.

## Layout

```
voice builder/
├── app/                      Next.js 15 App Router pages + API routes
│   ├── layout.tsx
│   ├── page.tsx              Landing
│   ├── bots/new/page.tsx     Step 0 wizard UI (client component)
│   └── api/prefill/route.ts  Server-side POST → calls src/prefill
├── reference_prompts/        4 real production prompts used as compile test cases
├── schema/                   Postgres DDL (builder.* schema, shared Supabase with Voice Monitor)
├── WIZARD_GAPS.md            What the wizard model can't (yet) express
├── next.config.mjs           Next.js config
├── tailwind.config.ts        Tailwind CSS config
└── src/
    ├── compile/              compileBot() — turns wizard JSON into a Retell agent payload
    │   ├── types.ts          Bot + Retell payload types
    │   ├── compileBot.ts     Pure function: Bot → RetellAgentPayload
    │   ├── run.ts            CLI driver
    │   └── fixtures/         4 hand-built bot.json fixtures (Mark Butcher, Choice, Team Green, Property Cloud)
    └── prefill/              Step 0 — turn a plain-English description into a PrefilledBot via GPT-5.5
        ├── types.ts          PrefilledBot subset of Bot
        ├── schema.ts         JSON Schema for OpenAI strict structured outputs
        ├── prompt.ts         System prompt (voice catalog, defaults, branching rules)
        ├── prefill.ts        fetch() against /v1/chat/completions
        ├── run.ts            CLI driver
        ├── README.md         Usage + evaluation guide
        └── fixtures/         4 realistic operator-typed input descriptions
```

## Running the compile

Requires Node 22+ (for `--experimental-strip-types`):

```powershell
npm run compile:run                          # defaults to 01_mark_butcher
npm run compile:run 02_choice_mortgages
npm run compile:run 03_team_green
npm run compile:run 04_the_property_cloud
```

Prints the full Retell payload to stdout. Each fixture also has a captured `.out.txt` (gitignored) for quick diffing.

See `WIZARD_GAPS.md` for what the 4 fixtures revealed about wizard limitations.

## Running the prefill (Step 0)

```powershell
$env:OPENAI_API_KEY = "sk-..."
npm run prefill:run -- --input 01_mark_butcher    # uses src/prefill/fixtures/01_mark_butcher.input.md
npm run prefill:run -- "Your business description here..." --industry "Dental"
```

Default model: `gpt-5.5`. Override with `$env:OPENAI_MODEL = "..."`.

See `src/prefill/README.md` for details + how to evaluate output against the 4 fixtures.

## Running the Next.js app

First time setup (with the corporate-SSL workaround if needed):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm install
copy .env.example .env.local      # then edit and add OPENAI_API_KEY
```

Then:

```powershell
npm run dev
```

Open http://localhost:3000 → click "Create your first bot" → fill in the description and click "Generate draft". The page calls `POST /api/prefill` server-side, which uses `OPENAI_API_KEY` from `.env.local` and returns the `PrefilledBot` JSON to the browser.

## What's done

- [x] Wizard step structure (11 screens, see project memory)
- [x] White-label-safe terminology (no "GHL" in copy)
- [x] Schema DDL (`schema/001_init.sql`)
- [x] `compileBot()` v0 with all section renderers
- [x] 4 production-prompt fixtures (Mark Butcher, Choice Mortgages, Team Green, Property Cloud) — all compile cleanly
- [x] Gap analysis: `WIZARD_GAPS.md` (14 gaps catalogued, prioritised P1/P2/P3)

## What's next

- [x] Apply the P1 gap fixes (G1–G5 in `WIZARD_GAPS.md`) to wizard + schema + compileBot
- [x] Re-run all 4 fixtures and confirm they reproduce the references' behaviour
- [x] Step 0 (Describe → AI pre-fill) — GPT-5.5 structured-output prompt + schema
- [ ] Run prefill against the 4 input fixtures with a real API key and compare to the hand-built `.bot.json` fixtures; iterate on `prompt.ts` if needed
- [ ] Verify schema against a Supabase staging branch (RLS subquery resolves)
- [ ] Drizzle definitions from `001_init.sql`
- [ ] Next.js app shell (auth, wizard UI, tenant routing) — share Supabase project with Voice Monitor
