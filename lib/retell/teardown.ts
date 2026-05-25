// Tear down a deployed Retell agent + LLM. Called when an SMB's
// subscription is cancelled so they can't keep using infrastructure they're
// not paying for. We swallow individual errors — if one resource is already
// gone, we still want to delete the other.

const DEFAULT_BASE = 'https://api.retellai.com';

export interface TeardownInput {
  agent_id: string | null;
  llm_id: string | null;
}

export async function teardownRetellAgent(input: TeardownInput): Promise<void> {
  const apiKey = process.env.RETELL_API_KEY;
  if (!apiKey) {
    console.warn('[retell/teardown] RETELL_API_KEY not set, skipping');
    return;
  }
  const base = process.env.RETELL_API_BASE || DEFAULT_BASE;

  if (input.agent_id) {
    try {
      const res = await fetch(`${base}/delete-agent/${input.agent_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok && res.status !== 404) {
        const detail = await res.text().catch(() => '');
        console.warn('[retell/teardown] delete-agent failed:', res.status, detail);
      }
    } catch (e) {
      console.warn('[retell/teardown] delete-agent threw:', e);
    }
  }

  if (input.llm_id) {
    try {
      const res = await fetch(`${base}/delete-retell-llm/${input.llm_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok && res.status !== 404) {
        const detail = await res.text().catch(() => '');
        console.warn('[retell/teardown] delete-llm failed:', res.status, detail);
      }
    } catch (e) {
      console.warn('[retell/teardown] delete-llm threw:', e);
    }
  }
}
