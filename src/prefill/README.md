# Step 0 — Describe → AI pre-fill

Turns a brief business description into a `PrefilledBot` JSON object that the wizard pre-loads. The operator/end-client then reviews and refines.

## Model

Default: **`gpt-5.5`** (per user preference, 2026-05-19).

Override via env: `OPENAI_MODEL=gpt-5.5-turbo` or whatever the exact API identifier is when this runs. The current default in `prefill.ts` is `'gpt-5.5'` — verify against OpenAI's published model list at integration time.

## How it talks to OpenAI

No SDK install. Plain `fetch()` to `POST /v1/chat/completions` with:

```json
{
  "model": "gpt-5.5",
  "messages": [{ "role": "system", ... }, { "role": "user", ... }],
  "response_format": {
    "type": "json_schema",
    "json_schema": { "name": "PrefilledBot", "strict": true, "schema": <prefillSchema> }
  }
}
```

`prefillSchema` (`schema.ts`) mirrors `PrefilledBot` (`types.ts`) and uses `$defs` + `$ref` to keep inline depth shallow (well under OpenAI's 5-level limit).

## Run it

```powershell
$env:OPENAI_API_KEY = "sk-..."

# From a one-liner:
npm run prefill:run -- "I run a dental practice in Manchester. The bot books cleanings and routes emergencies to Dr Smith."

# From a pre-written fixture:
npm run prefill:run -- --input 01_mark_butcher
npm run prefill:run -- --input 02_choice_mortgages
npm run prefill:run -- --input 03_team_green
npm run prefill:run -- --input 04_the_property_cloud
```

The compiled `PrefilledBot` JSON is printed to stdout. Pipe to a file to save:

```powershell
npm run prefill:run -- --input 02_choice_mortgages > tmp_choice.json
```

The wizard will then merge it with system-supplied fields (id, agency_id, twilio_*, crm_*, status) to form a full `Bot`, which `compileBot()` can then turn into a Retell agent payload.

## What the AI fills vs what it leaves

**AI fills** (in `PrefilledBot`):
- Identity (business_name, industry, language, working_hours, timezone)
- Voice + tone (one of the 4 fixed voice IDs, tone chips, opening line)
- Knowledge (services, FAQs, hard_guardrails, escalation_rules)
- Transfer settings (enabled + triggers; phone number left null)
- Cost defaults (max duration, daily cap)
- Booking parameters (enabled + window + hours; calendar ID left for Step 8)
- Custom tools (with placeholder webhook URLs)
- Reason branches (only when 2+ branches truly need different fields)
- Capture fields + verify-before-close
- Post-call analysis schema
- Tier suggestion

**AI explicitly does NOT fill** (filled by the wizard or operator):
- `id`, `agency_id`, `client_id`, `status`
- `twilio_phone_e164` (Step 6 buys it)
- `crm_status`, `crm_location_id`, `booking_calendar_id`, `crm_workflow_id` (Step 7+8+9 bindings)
- `transfer_number` (operator pastes the real phone number)
- `retell_agent_id` (set on first compile)

## Validating prefill quality against the 4 fixtures

Each input in `fixtures/*.input.md` is a realistic operator-typed description. After running prefill on each, eyeball-compare the output against the hand-built fixture at `src/compile/fixtures/*.bot.json`:

| Input | Should match its fixture on | Should diverge on |
|---|---|---|
| 01_mark_butcher | booking_enabled=false, marketing-end captures, 5 escalation_rules | exact FAQ wording, exact services list |
| 02_choice_mortgages | booking_enabled=true, booking_hours Mon-Fri 9-5, verify_capture_before_close=true, 3 before_action captures, financial-advice guardrails | wording of guardrails |
| 03_team_green | booking_enabled=false, custom_tools has send_sms, escalation_rules covers 999/gas/power, 4 early captures | wording of triage steps |
| 04_the_property_cloud | booking_enabled=false, custom_tools has SMS link tool, 4 reason_branches, "no live data" + "never confirm appointment" guardrails | exact branch keywords |

If the prefill output drifts substantially on the "should match" column, tighten the system prompt in `prompt.ts`.

## When to re-run

- After any change to the wizard model (types.ts, schema.ts) — verify the AI can still produce valid output
- After any change to `prompt.ts` — re-test all 4 fixtures
- When a new industry is introduced — add a fixture and test
