import { MeshkitError } from './types.js';
import type { PinCount } from './types.js';

interface PinLsLine {
  Cid?: string;
  Type?: string;
  Keys?: Record<string, { Type?: string }>;
  Pins?: string[];
}

/**
 * Count pins by type on a Kubo node by streaming `pin ls --type=all`.
 *
 * Tallies counts line-by-line without accumulating CIDs, so memory usage is
 * constant regardless of pinset size — unlike `listPins`, which returns the
 * full list. Handles the streamed NDJSON format (`{"Cid":...,"Type":...}`)
 * and the legacy `Keys` mapping. The legacy `Pins` array format carries no
 * pin type and is ignored.
 */
export async function countPinsViaRpc(
  apiUrl: string,
  headers?: Record<string, string>,
): Promise<PinCount> {
  const url = new URL('/api/v0/pin/ls', apiUrl);
  url.searchParams.set('type', 'all');
  url.searchParams.set('stream', 'true');

  const response = await fetch(url, {
    method: 'POST',
    ...(headers ? { headers } : {}),
  });
  if (!response.ok) {
    throw new MeshkitError(
      `Failed to list pins at ${apiUrl} (HTTP ${response.status}).`,
    );
  }
  if (!response.body) {
    throw new MeshkitError(`Failed to list pins at ${apiUrl} (empty body).`);
  }

  const counts: PinCount = { direct: 0, recursive: 0, indirect: 0, total: 0 };
  let buffer = '';
  const decoder = new TextDecoder();

  // Node's fetch returns a web ReadableStream, async-iterable on Node 20+.
  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      applyPinLsLine(buffer.slice(0, newlineIndex), counts);
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  buffer += decoder.decode();
  applyPinLsLine(buffer, counts);

  return counts;
}

/** Tally a single NDJSON line from Kubo `pin ls` output into `counts`. */
export function applyPinLsLine(line: string, counts: PinCount): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let parsed: PinLsLine;
  try {
    parsed = JSON.parse(trimmed) as PinLsLine;
  } catch {
    return;
  }

  if (parsed.Type) {
    bump(counts, parsed.Type);
  }
  if (parsed.Keys) {
    for (const entry of Object.values(parsed.Keys)) {
      if (entry?.Type) {
        bump(counts, entry.Type);
      }
    }
  }
}

function bump(counts: PinCount, type: string): void {
  if (type === 'direct') {
    counts.direct++;
  } else if (type === 'recursive') {
    counts.recursive++;
  } else if (type === 'indirect') {
    counts.indirect++;
  }
  counts.total++;
}
