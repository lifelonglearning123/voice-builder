// JSON Schema for OpenAI structured outputs (strict mode).
// Mirrors PrefilledBot from types.ts.
//
// Rules for OpenAI strict mode:
//   - Every object has additionalProperties: false
//   - Every object's `required` lists EVERY property
//   - No minLength / maxLength / minItems / maxItems / pattern / format
//     (those constraints live in the system prompt instead)
//   - Nullable scalars use type: ["string", "null"]; nullable objects use anyOf
//   - $defs + $ref keep nesting depth shallow

const TONE_CHIPS = [
  'Friendly',
  'Professional',
  'Warm',
  'Brisk',
  'Empathetic',
  'Reassuring',
] as const;

export const prefillSchema = {
  type: 'object',
  additionalProperties: false,
  $defs: {
    workingHoursSlot: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            open: { type: 'string', description: 'HH:MM (24h), e.g. "09:00"' },
            close: { type: 'string', description: 'HH:MM (24h), e.g. "17:00"' },
          },
          required: ['open', 'close'],
        },
      ],
    },
    workingHours: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mon: { $ref: '#/$defs/workingHoursSlot' },
        tue: { $ref: '#/$defs/workingHoursSlot' },
        wed: { $ref: '#/$defs/workingHoursSlot' },
        thu: { $ref: '#/$defs/workingHoursSlot' },
        fri: { $ref: '#/$defs/workingHoursSlot' },
        sat: { $ref: '#/$defs/workingHoursSlot' },
        sun: { $ref: '#/$defs/workingHoursSlot' },
      },
      required: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
    },
    service: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        description: { type: ['string', 'null'] },
        price: { type: ['string', 'null'] },
      },
      required: ['name', 'description', 'price'],
    },
    faq: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string' },
        a: { type: 'string' },
      },
      required: ['q', 'a'],
    },
    escalationRule: {
      type: 'object',
      additionalProperties: false,
      properties: {
        trigger: { type: 'string' },
        action: {
          type: 'string',
          enum: ['redirect_email', 'take_message', 'transfer_number', 'custom_response'],
        },
        detail: { type: 'string' },
      },
      required: ['trigger', 'action', 'detail'],
    },
    captureField: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'snake_case field name' },
        ask: { type: 'string', description: 'Exact question to ask the caller' },
        required: { type: 'boolean' },
        timing: {
          type: 'string',
          enum: ['early', 'before_action', 'marketing_end'],
        },
      },
      required: ['name', 'ask', 'required', 'timing'],
    },
    customToolParam: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['string', 'number', 'boolean'] },
        description: { type: 'string' },
        required: { type: 'boolean' },
      },
      required: ['name', 'type', 'description', 'required'],
    },
    customTool: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'snake_case identifier' },
        description: { type: 'string' },
        trigger: { type: 'string' },
        webhook_url: {
          type: 'string',
          description: 'Placeholder template, e.g. "https://platform.example.com/api/bots/{bot_id}/tools/<name>"',
        },
        parameters: {
          type: 'array',
          items: { $ref: '#/$defs/customToolParam' },
        },
      },
      required: ['name', 'description', 'trigger', 'webhook_url', 'parameters'],
    },
    reasonBranch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        match_keywords: {
          type: 'array',
          items: { type: 'string' },
        },
        capture_fields: {
          type: 'array',
          items: { $ref: '#/$defs/captureField' },
        },
      },
      required: ['name', 'match_keywords', 'capture_fields'],
    },
    postCallField: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        type: { type: 'string', enum: ['text', 'select', 'boolean', 'number'] },
        options: {
          anyOf: [
            { type: 'null' },
            { type: 'array', items: { type: 'string' } },
          ],
        },
        hint: { type: 'string' },
      },
      required: ['name', 'type', 'options', 'hint'],
    },
    conversationRules: {
      type: 'object',
      additionalProperties: false,
      properties: {
        one_question_at_a_time: { type: 'boolean' },
        max_sentences_per_response: { type: 'integer' },
        ai_disclosure_response: { type: 'string' },
        rotate_phrases_no_repeat_within_turns: { type: 'integer' },
      },
      required: [
        'one_question_at_a_time',
        'max_sentences_per_response',
        'ai_disclosure_response',
        'rotate_phrases_no_repeat_within_turns',
      ],
    },
    pronunciationRules: {
      type: 'object',
      additionalProperties: false,
      properties: {
        spell_phone_digit_by_digit: { type: 'boolean' },
        spell_email_aloud: { type: 'boolean' },
        phonetic_url: { type: 'boolean' },
      },
      required: ['spell_phone_digit_by_digit', 'spell_email_aloud', 'phonetic_url'],
    },
  },
  properties: {
    internal_name: { type: 'string', description: 'Admin-only label for this bot' },
    business_name: { type: 'string', description: 'How the bot refers to the business in speech' },
    business_address: {
      type: ['string', 'null'],
      description: 'Set only if the description explicitly mentions a location; otherwise null',
    },
    industry: { type: 'string' },
    language: { type: 'string', enum: ['en-GB', 'en-US'] },

    working_hours: { $ref: '#/$defs/workingHours' },
    timezone: { type: 'string', description: 'IANA timezone, e.g. "Europe/London"' },
    out_of_hours_behavior: {
      type: 'string',
      enum: ['answer_normally', 'take_message', 'reject_politely'],
    },

    agent_name: {
      type: 'string',
      description: 'Spoken bot name (e.g. "Sarah", "Emma"). Empty string if no specific name.',
    },
    voice_id: {
      type: 'string',
      description:
        'Leave empty string. The wizard\'s Step 2 forces the operator to pick from their Retell account.',
    },
    tone_chips: {
      type: 'array',
      description: 'Exactly 1-2 chips chosen from the allowed set',
      items: { type: 'string', enum: [...TONE_CHIPS] },
    },
    opening_line: {
      type: 'string',
      description: 'One sentence greeting that names business + agent and asks how to help',
    },
    conversation_rules: { $ref: '#/$defs/conversationRules' },
    pronunciation_rules: { $ref: '#/$defs/pronunciationRules' },

    services: {
      type: 'array',
      items: { $ref: '#/$defs/service' },
    },
    faqs: {
      type: 'array',
      items: { $ref: '#/$defs/faq' },
    },
    hard_guardrails: {
      type: 'array',
      items: { type: 'string' },
    },
    escalation_rules: {
      type: 'array',
      items: { $ref: '#/$defs/escalationRule' },
    },
    website_url: {
      type: ['string', 'null'],
      description: 'Null unless explicitly mentioned in the description',
    },

    transfer_enabled: { type: 'boolean' },
    transfer_triggers: { type: ['string', 'null'] },
    transfer_pre_line: { type: ['string', 'null'] },
    transfer_fallback: {
      anyOf: [
        { type: 'null' },
        { type: 'string', enum: ['take_message', 'drop_call'] },
      ],
    },

    max_call_duration_s: { type: 'integer' },
    daily_minute_cap: { type: 'integer' },

    booking_enabled: { type: 'boolean' },
    booking_services: { type: 'array', items: { type: 'string' } },
    booking_lead_time_minutes: { type: 'integer' },
    booking_max_future_days: { type: 'integer' },
    booking_confirmation_message: { type: ['string', 'null'] },
    booking_hours: {
      anyOf: [{ type: 'null' }, { $ref: '#/$defs/workingHours' }],
    },

    custom_tools: {
      type: 'array',
      items: { $ref: '#/$defs/customTool' },
    },
    reason_branches: {
      type: 'array',
      items: { $ref: '#/$defs/reasonBranch' },
    },

    capture_fields: {
      type: 'array',
      items: { $ref: '#/$defs/captureField' },
    },
    verify_capture_before_close: { type: 'boolean' },

    post_call_fields: {
      type: 'array',
      items: { $ref: '#/$defs/postCallField' },
    },
    save_audio: { type: 'boolean' },
    save_transcript: { type: 'boolean' },

    tier: { type: 'string', enum: ['starter', 'pro', 'premium'] },
  },
  required: [
    'internal_name',
    'business_name',
    'business_address',
    'industry',
    'language',
    'working_hours',
    'timezone',
    'out_of_hours_behavior',
    'agent_name',
    'voice_id',
    'tone_chips',
    'opening_line',
    'conversation_rules',
    'pronunciation_rules',
    'services',
    'faqs',
    'hard_guardrails',
    'escalation_rules',
    'website_url',
    'transfer_enabled',
    'transfer_triggers',
    'transfer_pre_line',
    'transfer_fallback',
    'max_call_duration_s',
    'daily_minute_cap',
    'booking_enabled',
    'booking_services',
    'booking_lead_time_minutes',
    'booking_max_future_days',
    'booking_confirmation_message',
    'booking_hours',
    'custom_tools',
    'reason_branches',
    'capture_fields',
    'verify_capture_before_close',
    'post_call_fields',
    'save_audio',
    'save_transcript',
    'tier',
  ],
} as const;
