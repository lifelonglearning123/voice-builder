// Extract plain text from a user-uploaded knowledge document.
// Supports PDF (via unpdf), and plain-text formats (txt, md). Returns a
// trimmed string capped at MAX_CHARS so a 200-page PDF can't blow the OpenAI
// token budget or run the prefill into the context limit.

import { extractText as unpdfExtract, getDocumentProxy } from 'unpdf';

// ~30k chars ≈ ~7–8k tokens. The prefill prompt itself is small, so this
// leaves comfortable headroom for the description and the model's JSON output.
export const MAX_CHARS = 30_000;

export interface ExtractedText {
  text: string;
  truncated: boolean;
  pages?: number;
}

export type SupportedMime =
  | 'application/pdf'
  | 'text/plain'
  | 'text/markdown';

export function isSupportedMime(mime: string): mime is SupportedMime {
  return (
    mime === 'application/pdf' ||
    mime === 'text/plain' ||
    mime === 'text/markdown'
  );
}

// Some browsers send `application/octet-stream` for unrecognised types and
// `.md` is commonly sent as `text/x-markdown`. Map by extension as a fallback
// so we don't reject obvious cases.
export function resolveMime(reportedMime: string, filename: string): string {
  if (isSupportedMime(reportedMime)) return reportedMime;
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  return reportedMime;
}

export async function extractKnowledgeText(
  buffer: ArrayBuffer,
  mime: SupportedMime,
): Promise<ExtractedText> {
  if (mime === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    // mergePages: true guarantees a single string back from unpdf.
    const { text, totalPages } = await unpdfExtract(pdf, { mergePages: true });
    return finalise(text, totalPages);
  }

  // text/plain or text/markdown — decode as UTF-8.
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  return finalise(decoded);
}

function finalise(raw: string, pages?: number): ExtractedText {
  const cleaned = raw.replace(/\r\n/g, '\n').trim();
  const truncated = cleaned.length > MAX_CHARS;
  return {
    text: truncated ? cleaned.slice(0, MAX_CHARS) : cleaned,
    truncated,
    pages,
  };
}
