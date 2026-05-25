// TypeScript shape of a builder.bots row, plus the Retell agent payload
// emitted by compileBot(). Kept hand-authored for v1; once schema stabilises,
// generate from Drizzle introspection.

export type BotStatus = 'draft' | 'live' | 'paused' | 'archived';
export type Tier = 'starter' | 'pro' | 'premium';
export type CrmStatus = 'not_connected' | 'connected' | 'skipped' | 'error';
export type OutOfHoursBehavior =
  | 'answer_normally'
  | 'take_message'
  | 'reject_politely';
export type TransferFallback = 'take_message' | 'drop_call';

export interface Service {
  name: string;
  description?: string;
  price?: string;
}

export interface FAQ {
  q: string;
  a: string;
}

export type EscalationAction =
  | 'redirect_email'
  | 'take_message'
  | 'transfer_number'
  | 'custom_response';

export interface EscalationRule {
  trigger: string;
  action: EscalationAction;
  detail: string;
}

export interface PostCallField {
  name: string;
  type: 'text' | 'select' | 'boolean' | 'number';
  options?: string[];
  hint: string;
  crm_custom_field_id?: string | null;
}

// Data the bot must ask for during the call (distinct from post_call_fields,
// which is what the LLM extracts AFTER the call).
//   - early:           collect right after understanding the reason
//   - before_action:   collect immediately before booking/transfer
//   - marketing_end:   offer optionally near the end of the call
export type CaptureTiming = 'early' | 'before_action' | 'marketing_end';

export interface CaptureField {
  name: string;          // matches a post_call_fields name where applicable
  ask: string;           // exact question to ask the caller
  required: boolean;
  timing: CaptureTiming;
}

// G4 — operator-defined in-call tools (SMS, generic webhook actions).
// If the array is empty the bot has no custom tools — nothing about them
// appears in the prompt or in the Retell tool list.
export interface CustomToolParam {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export interface CustomTool {
  name: string;              // snake_case identifier, e.g. "send_sms"
  description: string;       // what the tool does
  trigger: string;           // instruction to the LLM: when to call it
  webhook_url: string;       // platform endpoint; Retell POSTs here when the LLM invokes
  parameters: CustomToolParam[];
}

// G5 — reason-based conditional capture. Top-level capture_fields apply to
// every caller; a branch's capture_fields apply only when the caller's intent
// matches the branch keywords.
export interface ReasonBranch {
  name: string;                  // human-readable label, e.g. "Valuation request"
  match_keywords: string[];      // hints for the LLM to identify this branch
  capture_fields: CaptureField[];
}

export interface ConversationRules {
  one_question_at_a_time: boolean;
  max_sentences_per_response: number;
  ai_disclosure_response: string;
  rotate_phrases_no_repeat_within_turns: number;
}

export interface PronunciationRules {
  spell_phone_digit_by_digit: boolean;
  spell_email_aloud: boolean;
  phonetic_url: boolean;
}

export interface WorkingHoursSlot {
  open: string;
  close: string;
}

export type WorkingHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', WorkingHoursSlot | null>
>;

export interface AlertRecipient {
  email: string;
  channels: ('email' | 'whatsapp')[];
}

export interface Bot {
  id: string;
  agency_id: string;
  client_id: string;

  // Step 1 — Business basics
  internal_name: string;
  business_name: string;
  business_address: string | null;
  industry: string | null;
  language: string;
  working_hours: WorkingHours;
  timezone: string;
  out_of_hours_behavior: OutOfHoursBehavior;

  // Step 2 — How it sounds
  agent_name: string;
  voice_id: string;
  tone_chips: string[];
  opening_line: string;
  conversation_rules: ConversationRules;
  pronunciation_rules: PronunciationRules;

  // Step 3 — Knowledge (Starter)
  services: Service[];
  faqs: FAQ[];
  hard_guardrails: string[];
  escalation_rules: EscalationRule[];

  // Step 3 — Knowledge (Pro)
  website_url: string | null;

  // Step 4 — Transfer
  transfer_enabled: boolean;
  transfer_number: string | null;
  transfer_triggers: string | null;
  transfer_pre_line: string | null;
  transfer_fallback: TransferFallback | null;

  // Step 5 — Safety
  max_call_duration_s: number;
  daily_minute_cap: number;
  monthly_minute_cap: number | null;
  alert_recipients: AlertRecipient[];

  // Step 6 — Phone
  twilio_phone_e164: string | null;

  // Step 7 — CRM
  crm_status: CrmStatus;
  crm_location_id: string | null;

  // Step 8 — Booking
  booking_enabled: boolean;
  booking_calendar_id: string | null;
  booking_services: string[];
  booking_lead_time_minutes: number;
  booking_max_future_days: number;
  booking_confirmation_message: string | null;
  // G3: when bookings are allowed (independent of when the bot answers).
  // null → use working_hours; {} → unrestricted; populated → constrain bookings.
  booking_hours: WorkingHours | null;

  // G4 — operator-defined custom in-call tools (e.g. SMS, generic webhooks).
  // Empty array means no custom tools — nothing emitted in prompt or Retell payload.
  custom_tools: CustomTool[];

  // G5 — reason-based conditional capture.
  // Empty array means no branching; only top-level capture_fields apply.
  reason_branches: ReasonBranch[];

  // Step 9 — Data capture (during call) + post-call analysis (after call)
  capture_fields: CaptureField[];
  verify_capture_before_close: boolean;
  post_call_fields: PostCallField[];
  save_audio: boolean;
  save_transcript: boolean;
  crm_workflow_id: string | null;
  fallback_email_to: string | null;
  fallback_email_template: string | null;

  tier: Tier;
  status: BotStatus;
}

// ---------------------------------------------------------------------------
// Retell payload shape (subset of fields we actually set on agent create/update)
// ---------------------------------------------------------------------------

export interface RetellTool {
  type: 'transfer_call' | 'end_call' | 'custom';
  name: string;
  description: string;
  // For custom tools: webhook + JSON-Schema parameters Retell will populate
  // when the LLM invokes the tool.
  url?: string;
  parameters?: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
  // For transfer_call: Retell requires a destination spec.
  transfer_destination?: {
    type: 'predefined';
    number: string;
  };
}

export type RetellPostCallFieldType = 'string' | 'number' | 'boolean' | 'enum';

export interface RetellPostCallField {
  type: RetellPostCallFieldType;
  name: string;
  description: string;
  choices?: string[];
}

export interface RetellAgentPayload {
  agent_name?: string;
  voice_id: string;
  language: string;
  general_prompt: string;
  general_tools: RetellTool[];
  post_call_analysis_data: RetellPostCallField[];
  begin_message: string;
  max_call_duration_ms: number;
  end_call_after_silence_ms: number;
}
