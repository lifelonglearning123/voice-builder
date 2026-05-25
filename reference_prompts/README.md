# Reference Prompts

Four production voice-bot prompts captured 2026-05-19. These are **gold test cases** for the `compileBot()` function — every wizard JSON we generate must be able to reproduce the structure of these prompts faithfully.

## Files

| # | File | Use case | Industry | Notable features |
|---|------|----------|----------|------------------|
| 1 | `01_mark_butcher.md` | Inbound product/location FAQ | Butcher / retail | Lots of FAQs, pronunciation rules (phone, email, URL), location-conditional delivery upsell |
| 2 | `02_choice_mortgages.md` | Inbound enquiry + callback booking | Mortgage broker | Strict data capture order, calendar booking, verification step before close |
| 3 | `03_team_green.md` | Inbound tenant support / triage | Property management | Issue triage, emergency escalation, SMS tool, phrase rotation rule |
| 4 | `04_the_property_cloud.md` | Inbound sales/lettings intake | Estate agency | Reason-based routing, no live data access caveat, SMS self-registration |

## How these map to the wizard

Each prompt is the **output** of the compile step. The wizard captures inputs that should produce a prompt with the same structure. Section-by-section mapping:

| Wizard step | Prompt section it produces |
|-------------|---------------------------|
| Step 1 (Business basics) | `# Personality` (business name, role) + `# Environment` (hours, location, today's date) |
| Step 2 (How it sounds) | `# Tone` block + opening line + pronunciation rules + conversation rules |
| Step 3 (What it knows) | `# Knowledge` (services, FAQs) + `# Guardrails` + escalation rules |
| Step 4 (Transfer) | `transfer_call` tool definition + trigger description in prompt |
| Step 8 (Booking, CRM-gated) | `check_availability` + `book_appointment` tool definitions + booking flow in `# Goal` |
| Step 9 (Post-call analysis) | Retell `post_call_analysis_data` schema (not part of system prompt) |

## TODOs for later

- For each reference prompt, hand-write the equivalent wizard JSON it would produce
- Add a `tests/compile.spec.ts` that loads each wizard JSON, runs `compileBot()`, and snapshot-compares the output against the reference prompt
- Identify any features in these prompts that the current wizard can't express → either add to wizard or note as Phase 2
