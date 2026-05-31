// Step 0 — Describe → AI pre-fill.
// PrefilledBot is the slice of Bot the AI generates from a brief business
// description. The wizard merges it with system-supplied fields (IDs, phone,
// CRM bindings, lifecycle) to form a complete Bot.

import type {
  CaptureField,
  ConversationRules,
  CustomTool,
  EscalationRule,
  FAQ,
  OutOfHoursBehavior,
  PostCallField,
  PronunciationRules,
  ReasonBranch,
  Service,
  Tier,
  TransferFallback,
  WorkingHours,
} from '../compile/types.ts';

// Retell voice IDs are dynamic per-account (e.g. "11labs-Adrian",
// "retell-Cimo", or "custom_voice_xxx"). The wizard's Step 2 fetches the live
// list from /api/retell/voices and forces the operator to pick a real one,
// so the prefill is free to emit any string — usually empty.
export type VoiceId = string;

export interface PrefilledBot {
  // Identity
  internal_name: string;
  business_name: string;
  business_address: string | null;
  industry: string;
  language: 'en-GB' | 'en-US';

  // Hours
  working_hours: WorkingHours;
  timezone: string;
  out_of_hours_behavior: OutOfHoursBehavior;

  // Voice & tone
  agent_name: string;
  voice_id: VoiceId;
  tone_chips: string[];
  opening_line: string;
  conversation_rules: ConversationRules;
  pronunciation_rules: PronunciationRules;

  // Knowledge
  services: Service[];
  faqs: FAQ[];
  hard_guardrails: string[];
  escalation_rules: EscalationRule[];
  website_url: string | null;

  // Transfer
  transfer_enabled: boolean;
  transfer_triggers: string | null;
  transfer_pre_line: string | null;
  transfer_fallback: TransferFallback | null;

  // Safety
  max_call_duration_s: number;
  daily_minute_cap: number;

  // Booking (calendar binding deferred to Step 8)
  booking_enabled: boolean;
  booking_services: string[];
  booking_lead_time_minutes: number;
  booking_max_future_days: number;
  booking_confirmation_message: string | null;
  booking_hours: WorkingHours | null;

  // G4 / G5
  custom_tools: CustomTool[];
  reason_branches: ReasonBranch[];

  // G1 / G2
  capture_fields: CaptureField[];
  verify_capture_before_close: boolean;

  // Post-call
  post_call_fields: PostCallField[];
  save_audio: boolean;
  save_transcript: boolean;

  // Tier suggestion
  tier: Tier;
}

export interface PrefillRequest {
  description: string;
  industry?: string;
  website_url?: string;
  // Plain text extracted from an uploaded knowledge document (PDF, txt, md).
  // The /api/prefill route handles extraction; callers below the API boundary
  // pass the resolved text directly.
  knowledge_text?: string;
}

export interface PrefillResult {
  bot: PrefilledBot;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface PrefillOptions {
  apiKey: string;
  model?: string;       // default 'gpt-5.5'
  baseURL?: string;     // default 'https://api.openai.com/v1'
}
