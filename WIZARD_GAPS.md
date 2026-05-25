# Wizard model gaps — surfaced by 4 production reference prompts

Ran `compileBot()` against four hand-written fixtures (Mark Butcher, Choice Mortgages, Team Green, The Property Cloud) and compared the output to the reference prompts in `reference_prompts/`. This document lists everything the current wizard model **cannot yet express**, prioritised.

For each gap: severity, which fixtures expose it, what the reference prompt does that the compile misses, and proposed wizard change.

---

## P1 — fix before Phase 1 ships

These break real production prompts. Cheap to add to the wizard.

### G1. Marketing capture step (name/phone/email collection during call) ✅ DONE 2026-05-19

**Exposes:** Mark Butcher, Choice Mortgages, The Property Cloud
**What was missing:** The wizard had `post_call_fields` for *extraction* but no concept of fields the bot must **ask for during the conversation**, in order. Mark Butcher captures name for marketing; Choice Mortgages captures name+phone+email in strict order; Property Cloud captures name+email at the start.
**Resolved:**
- Added `capture_fields: CaptureField[]` to Bot (types.ts) and `builder.bots.capture_fields jsonb` to schema.
- Each `CaptureField` has `{ name, ask, required, timing }` where timing ∈ `early | before_action | marketing_end`.
- `compileBot` adds a `# Data Capture` section to the prompt and weaves the right capture steps into the Goal flow at the right position (early → after understanding reason; before_action → before booking/transfer; marketing_end → near the close).
- Confirmed by re-running all 4 fixtures: Mark Butcher offers marketing capture at end; Choice captures before booking; Team Green and Property Cloud capture early.

### G2. Data verification before close ✅ DONE 2026-05-19

**Exposes:** Choice Mortgages
**What was missing:** "Before I finish, I'll just confirm your details. I have your name as X, phone as Y, email as Z — is that correct?" No toggle for read-back verification.
**Resolved:**
- Added `verify_capture_before_close: boolean` to Bot and `builder.bots.verify_capture_before_close` to schema.
- When `true`, `compileBot` injects a Goal step before close: "Before closing, read back each required captured detail (X, Y, Z) and ask the caller to confirm. If anything is wrong, update before proceeding."
- Confirmed by Choice Mortgages output: step 6 now reads `Before closing, read back each required captured detail (caller_full_name, caller_phone, caller_email) and ask the caller to confirm. If anything is wrong, update before proceeding.`

### G3. Booking window: day-of-week + hour-of-day constraints ✅ DONE 2026-05-19

**Exposes:** Choice Mortgages
**What was missing:** Reference says "Only schedule Mon-Fri 9am-5pm" — separate from the bot's answering hours. Wizard had `booking_lead_time_minutes` + `booking_max_future_days` but no day/hour booking window.
**Resolved:**
- Added `booking_hours: WorkingHours | null` to Bot and `booking_hours jsonb` to schema. NULL = use working_hours; populated = constrain bookings.
- `compileBot` weaves the constraint into the booking Goal step: "If the caller wants an appointment, use the check_availability and book_appointment tools. Bookings are only available Mon 09:00-17:00, … Sat closed, Sun closed — do not offer slots outside this window."
- Confirmed by Choice Mortgages output, step 5.

### G4. Custom in-call tools (SMS, generic webhook) ✅ DONE 2026-05-19

**Exposes:** Team Green (`send_sms`), The Property Cloud (`send_registration_link`)
**What was missing:** Wizard supported only transfer, check_availability, book_appointment, search_knowledge, end_call — no way to add arbitrary in-call webhooks.
**Resolved:**
- Added `CustomTool` and `CustomToolParam` types; added `custom_tools: CustomTool[]` to Bot; added `custom_tools jsonb` to schema. Empty array = no tools registered, no Custom Actions section emitted (per "don't show if not available" rule).
- Each tool has `{ name, description, trigger, webhook_url, parameters[] }`. Compile registers each as a Retell `custom` tool with `url` + JSON-Schema `parameters` (built from the param list).
- New `# Custom Actions` prompt section lists each tool with its description, trigger, and required arguments.
- Goal flow gains a step: "When the relevant conditions occur, call the matching tool listed in the Custom Actions section."
- Confirmed by Team Green output (send_sms registered with url + parameters; appears in tools list with required: ["mobile_number","issue_summary"]) and Property Cloud (send_registration_link registered with phone_number required).

### G5. Reason-based conditional capture (different fields per branch) ✅ DONE 2026-05-19

**Exposes:** The Property Cloud (Sales/Lettings vs Valuation vs Surveyor capture sets)
**What was missing:** A flat `post_call_fields` list couldn't express "capture A,B,C for sales; D,E,F for valuation; G,H,I for surveyor".
**Resolved:**
- Added `ReasonBranch` type with `{ name, match_keywords, capture_fields }`; added `reason_branches: ReasonBranch[]` to Bot and `reason_branches jsonb` to schema. Empty array → no branching emitted.
- `compileBot` adds a "Conditional by reason" sub-section to `# Data Capture` listing each branch with its keywords and the extra fields it requires. The "Other" branch (no keywords) is rendered with "use when none of the other branches match."
- Goal flow gains routing steps: "Identify which reason branch matches the caller (see Data Capture). You will use that branch to drive the rest of the conversation." + capture step references both unconditional + matching-branch fields.
- Confirmed by Property Cloud output: 4 branches (Sales/Lettings, Valuation, Surveyor, Other) all rendered with their keywords and field lists.

---

## P2 — defer to Phase 2 but flag in wizard now

### G6. Repeat-caller handling

**Exposes:** The Property Cloud ("If number or email matches: 'I think we have your details. Can I confirm your email is X?'")
**What's missing:** Requires reading from CRM (GHL contact lookup by phone) at call start and exposing the result to the prompt. Cross-cutting feature.
**Proposed:** Phase 2. Add `match_existing_contact: boolean` toggle on the bot; if on, the Retell custom function `lookup_contact(phone)` is registered, and the prompt instructs the bot to call it first and confirm if a match.

### G7. After-hours behaviour: different closing line, same intake

**Exposes:** The Property Cloud ("Thanks, I've sent the self-registration link by text. The team will call you back on the next business day.")
**What's missing:** Wizard's `out_of_hours_behavior` is one of `answer_normally` / `take_message` / `reject_politely`. There's no "answer normally but with a different closing line".
**Proposed:** Add `out_of_hours_closing_override: string | null` to the bot. If set, compile emits a conditional closing line based on `{{system__time_utc}}` and `working_hours`.

### G8. Triage steps as structured content (with conditional checks)

**Exposes:** Team Green ("Check that the appliance is plugged in", "Ensure the breaker hasn't tripped")
**What's missing:** Reference embeds safe-to-suggest troubleshooting steps. Currently encoded as a one-line guardrail; better as a structured list with optional pre-conditions ("if issue = electrical, suggest breaker check").
**Proposed:** Phase 2. Add `triage_steps` repeater to Step 3: step + when_to_offer (free text).

### G9. Abuse warning + auto-end-call

**Exposes:** The Property Cloud ("if abusive, warn once and end the call politely")
**What's missing:** Wizard has no concept of "warn the caller, then end the call on next infraction". Currently caller can be abusive forever; bot would stay polite.
**Proposed:** Phase 2. Add `abuse_warning: { enabled, warning_line, end_after_repeat }` to the bot. Compile registers a `flag_abuse` tool and instructs the bot to call it on detection.

### G10. Multi-channel post-call notifications (email + SMS + WhatsApp staff alert)

**Exposes:** Team Green ("Notify the appropriate Team Green Group personnel via email, SMS, or WhatsApp")
**What's missing:** Step 9 currently routes via one GHL workflow OR Resend email. Real bots fan out to multiple channels for staff alerts.
**Proposed:** Phase 2. Either rely on the GHL workflow doing the fan-out (cleanest — keeps platform simple), or add a "Post-call notifications" repeater in Step 9 with per-channel templates.

---

## P3 — nice to have, not on the critical path

### G11. Industry-based voice defaults

**Exposes:** Mark Butcher (no clear voice signal); compile required the operator to pick.
**Proposed:** In Step 0's AI pre-fill, default the voice based on industry. Trades/construction → Male 2. Mortgage/legal/property → Female 1 or 2. Hospitality/retail → Female 1 (warmer). Operator can change.

### G12. "Transparency caveats" as a first-class field

**Exposes:** The Property Cloud ("I can't check the website live during this call")
**What's missing:** Honest caveats currently live in `hard_guardrails`, mixed with "do not" rules. Functionally fine; semantically muddled.
**Proposed:** Optional split — `transparency_statements` repeater alongside `hard_guardrails`. Compile renders them together in the Tone section.

### G13. Personality prefix override

**Exposes:** Mark Butcher (reference says "You are Mark's Mobile Butchers' customer support AI" — current compile emits "You are the customer support assistant for X")
**What's missing:** No way to override the personality opening if the operator wants different phrasing.
**Proposed:** Optional `personality_override: string | null`. If set, replaces the entire generated Personality block.

### G14. Variable interpolation in opening_line

**Exposes:** Choice Mortgages (`Good {{time_of_day}}`)
**What's missing:** Currently the opening line is a literal string; `{{time_of_day}}` is passed through verbatim, which Retell may or may not expand. The wizard doesn't enumerate which template variables are supported.
**Proposed:** Document the supported variables (`{{time_of_day}}`, `{{system__time_utc}}`, `{{caller_name}}` if captured) in a tooltip, and lint the opening_line in the wizard against unknown ones.

---

## What worked well across all 4 fixtures

- The 9-section template structure (Personality → Environment → Tone → Goal → Knowledge → Guardrails → Escalation → Pronunciation → Closing) reproduces every reference prompt's information faithfully — even if word-for-word it differs.
- Empty-section skipping (`working_hours: {}` → no hours line; no transfer → no `transfer_call` tool; not Premium → no `search_knowledge`) keeps output clean.
- JSONB repeaters (services, FAQs, guardrails, escalation rules) compile reliably with no edge cases hit.
- `escalation_rules` with 4 action types (`redirect_email` / `take_message` / `transfer_number` / `custom_response`) covered every escalation pattern in the 4 references.
- Post-call analysis schema mapping (`select` → `enum` with choices, `boolean` → `boolean`, etc.) is clean.
- Pure-function determinism: every run produced identical output on identical input.

---

## Recommended order of work

1. ~~**Add G1 (marketing capture) and G2 (verification)**~~ ✅ Done 2026-05-19.
2. ~~**Add G3 (booking hours)**~~ ✅ Done 2026-05-19.
3. ~~**Add G4 (custom in-call tools)**~~ ✅ Done 2026-05-19. JSON-Schema parameter builder UI deferred to Phase 2; backend supports it via `CustomToolParam[]`.
4. ~~**Add G5 (reason-based capture)**~~ ✅ Done 2026-05-19.
5. Everything else (G6–G14) is Phase 2 / nice-to-have.

**All P1 gaps closed.** All four fixtures recompile cleanly with the new fields populated where applicable. Next milestone is the UI / wizard frontend.
