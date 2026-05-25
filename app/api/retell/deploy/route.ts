import { NextResponse } from 'next/server';
import type { RetellAgentPayload } from '@/src/compile/types.ts';

// POST /api/retell/deploy
//
// Body: { payload: RetellAgentPayload } — the output of compileBot().
//
// Two-step Retell deploy:
//   1. POST /create-retell-llm — registers the prompt, tools and post-call
//      analysis schema. Returns llm_id.
//   2. POST /create-agent — references the llm_id and sets voice/language.
//      Returns agent_id.
//
// Env:
//   RETELL_API_KEY — required
//   RETELL_API_BASE — optional override (defaults to https://api.retellai.com)

export const runtime = 'nodejs';

const DEFAULT_BASE = 'https://api.retellai.com';

interface DeployBody {
  payload: RetellAgentPayload;
}

export async function POST(req: Request) {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RETELL_API_KEY not set on the server.' },
      { status: 500 },
    );
  }

  let body: DeployBody;
  try {
    body = (await req.json()) as DeployBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const payload = body?.payload;
  if (!payload?.voice_id || !payload?.general_prompt) {
    return NextResponse.json(
      { error: 'payload.voice_id and payload.general_prompt are required' },
      { status: 400 },
    );
  }

  const base = process.env.RETELL_API_BASE || DEFAULT_BASE;

  const llmRes = await fetch(`${base}/create-retell-llm`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      general_prompt: payload.general_prompt,
      general_tools: payload.general_tools,
      begin_message: payload.begin_message,
    }),
  });

  if (!llmRes.ok) {
    const detail = await llmRes.text().catch(() => '');
    return NextResponse.json(
      {
        error: `Retell create-retell-llm returned ${llmRes.status}`,
        detail: detail.slice(0, 500),
      },
      { status: 502 },
    );
  }

  const llmData = (await llmRes.json()) as { llm_id?: string };
  const llmId = llmData?.llm_id;
  if (!llmId) {
    return NextResponse.json(
      { error: 'Retell did not return an llm_id', detail: JSON.stringify(llmData) },
      { status: 502 },
    );
  }

  const agentRes = await fetch(`${base}/create-agent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      response_engine: { type: 'retell-llm', llm_id: llmId },
      voice_id: payload.voice_id,
      language: payload.language,
      agent_name: payload.agent_name,
      max_call_duration_ms: payload.max_call_duration_ms,
      end_call_after_silence_ms: payload.end_call_after_silence_ms,
      post_call_analysis_data: payload.post_call_analysis_data,
    }),
  });

  if (!agentRes.ok) {
    const detail = await agentRes.text().catch(() => '');
    return NextResponse.json(
      {
        error: `Retell create-agent returned ${agentRes.status}`,
        detail: detail.slice(0, 500),
        llm_id: llmId,
      },
      { status: 502 },
    );
  }

  const agentData = (await agentRes.json()) as { agent_id?: string };
  const agentId = agentData?.agent_id;
  if (!agentId) {
    return NextResponse.json(
      {
        error: 'Retell did not return an agent_id',
        detail: JSON.stringify(agentData),
        llm_id: llmId,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ agent_id: agentId, llm_id: llmId });
}
