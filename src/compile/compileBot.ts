import type {
  Bot,
  CaptureField,
  CaptureTiming,
  CustomTool,
  EscalationRule,
  PostCallField,
  ReasonBranch,
  RetellAgentPayload,
  RetellPostCallField,
  RetellTool,
  WorkingHours,
} from './types.ts';

// Compile a bot config row into a Retell agent payload.
// Pure function: no I/O, no side effects, fully deterministic.

export function compileBot(bot: Bot): RetellAgentPayload {
  const sections: string[] = [];

  pushSection(sections, 'Personality', renderPersonality(bot));
  pushSection(sections, 'Environment', renderEnvironment(bot));
  pushSection(sections, 'Tone', renderTone(bot));
  pushSection(sections, 'Goal / Call Flow', renderGoal(bot));
  pushSection(sections, 'Data Capture', renderDataCapture(bot));
  pushSection(sections, 'Custom Actions', renderCustomActions(bot));
  pushSection(sections, 'Knowledge', renderKnowledge(bot));
  pushSection(sections, 'Guardrails', renderGuardrails(bot));
  pushSection(sections, 'Escalation routing', renderEscalation(bot.escalation_rules));
  pushSection(sections, 'Pronunciation rules', renderPronunciation(bot));
  pushSection(sections, 'Closing', renderClosing(bot));

  return {
    // Name shown in the voice service's dashboard — not what the receptionist
    // calls itself on calls. Composed from business + (optional) persona so
    // operators with dozens of agents can find the right one at a glance.
    agent_name: buildRetellAgentName(bot),
    voice_id: bot.voice_id,
    language: bot.language,
    general_prompt: sections.join('\n\n'),
    general_tools: buildTools(bot),
    post_call_analysis_data: buildPostCallSchema(bot.post_call_fields),
    begin_message: bot.opening_line,
    max_call_duration_ms: bot.max_call_duration_s * 1000,
    end_call_after_silence_ms: 30_000,
  };
}

function buildRetellAgentName(bot: Bot): string {
  const business = bot.business_name?.trim() || '';
  const persona = bot.agent_name?.trim() || '';
  if (business && persona) return `${business} — ${persona}`;
  if (business) return business;
  if (persona) return persona;
  return 'Unnamed receptionist';
}

function pushSection(out: string[], title: string, content: string): void {
  if (!content.trim()) return;
  out.push(`# ${title}\n${content.trim()}`);
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderPersonality(bot: Bot): string {
  const head = bot.agent_name
    ? `You are ${bot.agent_name}, the virtual assistant for ${bot.business_name}.`
    : `You are the customer support assistant for ${bot.business_name}.`;
  const traits = bot.tone_chips.length > 0
    ? ` You are ${joinAnd(bot.tone_chips.map((c) => c.toLowerCase()))}.`
    : '';
  return head + traits;
}

function renderEnvironment(bot: Bot): string {
  const lines: string[] = [];
  lines.push(`Inbound call. Caller is contacting ${bot.business_name}.`);
  if (bot.business_address) {
    lines.push(`Business location: ${bot.business_address}.`);
  }
  lines.push('Today: {{system__time_utc}}');
  lines.push(`Timezone: ${bot.timezone}`);

  const hasHours = bot.working_hours && Object.keys(bot.working_hours).length > 0;
  if (hasHours) {
    lines.push(`Opening hours: ${formatHours(bot.working_hours)}.`);
    if (bot.out_of_hours_behavior === 'take_message') {
      lines.push(
        'Outside opening hours, take a brief message and tell the caller the business is closed.',
      );
    } else if (bot.out_of_hours_behavior === 'reject_politely') {
      lines.push(
        'Outside opening hours, politely tell the caller the business is closed and end the call.',
      );
    }
  }
  return lines.join('\n');
}

function renderTone(bot: Bot): string {
  const lines: string[] = [];
  if (bot.tone_chips.length > 0) {
    lines.push(`- Tone: ${joinAnd(bot.tone_chips)}.`);
  }
  if (bot.conversation_rules.one_question_at_a_time) {
    lines.push('- Ask one question at a time.');
  }
  if (bot.conversation_rules.max_sentences_per_response) {
    lines.push(
      `- Keep each response to no more than ${bot.conversation_rules.max_sentences_per_response} sentences.`,
    );
  }
  if (bot.conversation_rules.rotate_phrases_no_repeat_within_turns) {
    lines.push(
      `- Do not repeat the same sentence or close variant within the last ${bot.conversation_rules.rotate_phrases_no_repeat_within_turns} turns.`,
    );
  }
  lines.push('- Acknowledge once, then act. Avoid stacking thanks or confirmations.');
  if (bot.conversation_rules.ai_disclosure_response) {
    lines.push(
      `- Do not volunteer that you are an AI; if asked, say: "${bot.conversation_rules.ai_disclosure_response}".`,
    );
  }
  return lines.join('\n');
}

function renderGoal(bot: Bot): string {
  const steps: string[] = [];
  steps.push('Greet the caller using the opening line.');
  steps.push('Understand the reason for the call before responding.');

  const capture = bot.capture_fields ?? [];
  const branches = bot.reason_branches ?? [];
  const customTools = bot.custom_tools ?? [];
  const hasEarly = capture.some((c) => c.timing === 'early');
  const hasBeforeAction = capture.some((c) => c.timing === 'before_action');
  const hasMarketingEnd = capture.some((c) => c.timing === 'marketing_end');
  const hasBranches = branches.length > 0;

  if (hasBranches) {
    steps.push(
      'Identify which reason branch matches the caller (see Data Capture). You will use that branch to drive the rest of the conversation.',
    );
  }
  if (hasEarly || hasBranches) {
    steps.push(
      'Capture the early fields listed in the Data Capture section (plus any extra fields from the matching reason branch) before continuing.',
    );
  }
  if (bot.faqs.length > 0 || bot.services.length > 0) {
    steps.push("Answer the caller's question accurately using the knowledge below.");
  }
  if (hasBeforeAction && (bot.booking_enabled || bot.transfer_enabled)) {
    steps.push(
      'Before booking or transferring, capture the before-action fields listed in the Data Capture section.',
    );
  }
  if (bot.booking_enabled) {
    const bookingHrs = bot.booking_hours;
    const constraint =
      bookingHrs && Object.keys(bookingHrs).length > 0
        ? ` Bookings are only available ${formatHours(bookingHrs)} — do not offer slots outside this window.`
        : '';
    steps.push(
      `If the caller wants an appointment, capture their preferred date, time window, and contact details so the team can confirm a slot.${constraint}`,
    );
  }
  if (bot.transfer_enabled) {
    steps.push(
      `If transfer is appropriate, say the pre-transfer line and call the transfer_call tool.`,
    );
  }
  if (customTools.length > 0) {
    steps.push(
      'When the relevant conditions occur, call the matching tool listed in the Custom Actions section.',
    );
  }
  if (hasMarketingEnd) {
    steps.push(
      'Near the end of the call, offer the marketing capture listed in the Data Capture section. The caller may decline; do not press.',
    );
  }
  if (bot.verify_capture_before_close && capture.some((c) => c.required)) {
    const fields = capture
      .filter((c) => c.required)
      .map((c) => c.name)
      .join(', ');
    steps.push(
      `Before closing, read back each required captured detail (${fields}) and ask the caller to confirm. If anything is wrong, update before proceeding.`,
    );
  }
  steps.push('Close politely with a one-sentence summary, then end the call.');

  const numbered = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `Your primary goal is to help the caller efficiently. Follow these steps, asking only one question at a time:\n${numbered}`;
}

function renderDataCapture(bot: Bot): string {
  const capture = bot.capture_fields ?? [];
  const branches = bot.reason_branches ?? [];
  if (capture.length === 0 && branches.length === 0) return '';

  const groups: Array<{ heading: string; timing: CaptureTiming }> = [
    {
      heading: 'Unconditional — early — capture after understanding the reason for the call',
      timing: 'early',
    },
    {
      heading: 'Unconditional — before-action — capture immediately before booking or transfer',
      timing: 'before_action',
    },
    {
      heading: 'Unconditional — marketing — offer near the end of the call, optional',
      timing: 'marketing_end',
    },
  ];

  const blocks: string[] = [];
  for (const g of groups) {
    const fields = capture.filter((c) => c.timing === g.timing);
    if (fields.length === 0) continue;
    blocks.push(`## ${g.heading}\n${formatFieldLines(fields)}`);
  }

  if (branches.length > 0) {
    const branchBlocks: string[] = [];
    for (const b of branches) {
      const kw =
        b.match_keywords.length > 0
          ? `Keywords: ${b.match_keywords.join(', ')}.`
          : 'No keywords — use when none of the other branches match.';
      const body = b.capture_fields.length > 0
        ? formatFieldLines(b.capture_fields)
        : '(no extra fields — this branch is just a routing label)';
      branchBlocks.push(`### Branch: ${b.name}\n${kw}\n${body}`);
    }
    blocks.push(
      `## Conditional by reason — capture these only if the caller's intent matches the branch\n${branchBlocks.join('\n\n')}`,
    );
  }

  return blocks.join('\n\n');
}

function formatFieldLines(fields: CaptureField[]): string {
  return fields
    .map((f) => {
      const req = f.required ? 'required' : 'optional';
      return `- ${f.name} (${req}) — Ask: "${f.ask}"`;
    })
    .join('\n');
}

function renderCustomActions(bot: Bot): string {
  const tools = bot.custom_tools ?? [];
  if (tools.length === 0) return '';
  return tools
    .map((t) => {
      const params = t.parameters.length > 0
        ? ` Required arguments: ${t.parameters.filter((p) => p.required).map((p) => p.name).join(', ') || 'none'}.`
        : '';
      return `- ${t.name} — ${t.description} Trigger: ${t.trigger}.${params}`;
    })
    .join('\n');
}

function renderKnowledge(bot: Bot): string {
  const blocks: string[] = [];
  if (bot.services.length > 0) {
    const items = bot.services
      .map((s) => {
        const desc = s.description ? ` — ${s.description}` : '';
        const price = s.price ? ` (${s.price})` : '';
        return `- ${s.name}${desc}${price}`;
      })
      .join('\n');
    blocks.push(`## Services\n${items}`);
  }
  if (bot.faqs.length > 0) {
    const items = bot.faqs
      .map((f) => `- Q: ${f.q}\n  A: ${f.a}`)
      .join('\n');
    blocks.push(`## FAQ\n${items}`);
  }
  if (bot.website_url) {
    blocks.push(`## Website\n${bot.website_url}`);
  }
  return blocks.join('\n\n');
}

function renderGuardrails(bot: Bot): string {
  if (bot.hard_guardrails.length === 0) return '';
  return bot.hard_guardrails.map((g) => `- ${g}`).join('\n');
}

function renderEscalation(rules: EscalationRule[]): string {
  if (rules.length === 0) return '';
  return rules
    .map((r) => {
      switch (r.action) {
        case 'redirect_email':
          return `- If the caller raises ${quote(r.trigger)}, direct them to email ${r.detail}.`;
        case 'take_message':
          return `- If the caller raises ${quote(r.trigger)}, offer to take a message; do not attempt to resolve it on the call.`;
        case 'transfer_number':
          return `- If the caller raises ${quote(r.trigger)}, transfer them to ${r.detail}.`;
        case 'custom_response':
          return `- If the caller raises ${quote(r.trigger)}, respond: "${r.detail}".`;
      }
    })
    .join('\n');
}

function renderPronunciation(bot: Bot): string {
  const lines: string[] = [];
  if (bot.pronunciation_rules.spell_phone_digit_by_digit) {
    lines.push(
      '- Pronounce phone numbers digit-by-digit. Example: "0117 321 4938" → "zero one one seven – three two one – four nine three eight". Keep spaces around the dash.',
    );
  }
  if (bot.pronunciation_rules.spell_email_aloud) {
    lines.push(
      '- Pronounce "@" as "at". Spell email addresses with each component separated by hyphens or "dot". Example: "info@example.co.uk" → "info at example dot co dot uk".',
    );
  }
  if (bot.pronunciation_rules.phonetic_url) {
    lines.push(
      '- For URLs, pronounce recognisable words normally and pronounce letter strings letter-by-letter. Say "dot" before each TLD. Example: "marksmobilebutchers.co.uk" → "marks mobile butchers dot co dot uk".',
    );
  }
  return lines.join('\n');
}

function renderClosing(_bot: Bot): string {
  return 'When the conversation is complete, thank the caller, summarise in one sentence, and end the call.';
}

// ---------------------------------------------------------------------------
// Tool building
// ---------------------------------------------------------------------------

function buildTools(bot: Bot): RetellTool[] {
  const tools: RetellTool[] = [];

  if (bot.transfer_enabled && bot.transfer_number) {
    tools.push({
      type: 'transfer_call',
      name: 'transfer_call',
      description: bot.transfer_triggers
        ? `Transfer the live call to a human. Trigger when: ${bot.transfer_triggers}.`
        : 'Transfer the live call to a human when appropriate.',
      transfer_destination: {
        type: 'predefined',
        number: bot.transfer_number,
      },
    });
  }

  // Booking + knowledge-base lookups are surfaced as operator-defined custom
  // tools (each with its own webhook). They are NOT emitted here as
  // placeholder customs — Retell rejects a custom tool that has no `url`.

  // G4 — operator-defined custom tools (e.g. send_sms, book_appointment)
  for (const ct of bot.custom_tools ?? []) {
    tools.push(buildCustomTool(ct));
  }

  tools.push({
    type: 'end_call',
    name: 'end_call',
    description: 'End the call when the conversation is complete.',
  });

  return tools;
}

function buildCustomTool(ct: CustomTool): RetellTool {
  const tool: RetellTool = {
    type: 'custom',
    name: ct.name,
    description: `${ct.description} Use when: ${ct.trigger}.`,
    url: ct.webhook_url,
  };
  if (ct.parameters.length > 0) {
    tool.parameters = {
      type: 'object',
      properties: Object.fromEntries(
        ct.parameters.map((p) => [p.name, { type: p.type, description: p.description }]),
      ),
      required: ct.parameters.filter((p) => p.required).map((p) => p.name),
    };
  }
  return tool;
}

// ---------------------------------------------------------------------------
// Post-call schema (Retell post_call_analysis_data)
// ---------------------------------------------------------------------------

function buildPostCallSchema(fields: PostCallField[]): RetellPostCallField[] {
  return fields.map((f) => {
    if (f.type === 'select' && f.options && f.options.length > 0) {
      return {
        type: 'enum',
        name: f.name,
        description: f.hint,
        choices: f.options,
      };
    }
    if (f.type === 'number') {
      return { type: 'number', name: f.name, description: f.hint };
    }
    if (f.type === 'boolean') {
      return { type: 'boolean', name: f.name, description: f.hint };
    }
    return { type: 'string', name: f.name, description: f.hint };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function joinAnd(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function quote(s: string): string {
  return `"${s}"`;
}

function formatHours(wh: WorkingHours): string {
  const order: (keyof WorkingHours)[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const labels: Record<string, string> = {
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
    sun: 'Sun',
  };
  return order
    .map((d) => {
      const slot = wh[d];
      if (!slot) return `${labels[d]} closed`;
      return `${labels[d]} ${slot.open}-${slot.close}`;
    })
    .join(', ');
}
