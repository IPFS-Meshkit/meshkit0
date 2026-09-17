import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPinLsLine, countPinsViaRpc } from '../src/pin-count.js';
import { MeshkitError } from '../src/types.js';
import type { PinCount } from '../src/types.js';

function counts(): PinCount {
  return { direct: 0, recursive: 0, indirect: 0, total: 0 };
}

describe('applyPinLsLine', () => {
  it('tallies streamed lines with a Type field', () => {
    const c = counts();
    applyPinLsLine('{"Cid":"QmFoo","Type":"recursive"}', c);
    applyPinLsLine('{"Cid":"QmBar","Type":"direct"}', c);
    applyPinLsLine('{"Cid":"QmBaz","Type":"indirect"}', c);

    expect(c).toEqual({ direct: 1, recursive: 1, indirect: 1, total: 3 });
  });

  it('tallies legacy Keys mapping entries', () => {
    const c = counts();
    applyPinLsLine('{"Keys":{"QmA":{"Type":"recursive"},"QmB":{"Type":"recursive"}}}', c);

    expect(c).toEqual({ direct: 0, recursive: 2, indirect: 0, total: 2 });
  });

  it('ignores blank and malformed lines', () => {
    const c = counts();
    applyPinLsLine('', c);
    applyPinLsLine('   ', c);
    applyPinLsLine('not json', c);

    expect(c).toEqual(counts());
  });

  it('counts unknown types into total only', () => {
    const c = counts();
    applyPinLsLine('{"Cid":"QmX","Type":"meta"}', c);

    expect(c).toEqual({ direct: 0, recursive: 0, indirect: 0, total: 1 });
  });
});

describe('countPinsViaRpc', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams pin ls output and returns counts by type', async () => {
    const body = [
      '{"Cid":"QmA","Type":"recursive"}',
      '{"Cid":"QmB","Type":"recursive"}',
      '{"Cid":"QmC","Type":"indirect"}',
      '{"Cid":"QmD","Type":"direct"}',
      '',
    ].join('\n');

    const fetchMock = vi.fn(async () => new Response(body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(countPinsViaRpc('http://127.0.0.1:5001')).resolves.toEqual({
      direct: 1,
      recursive: 2,
      indirect: 1,
      total: 4,
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toBe(
      'http://127.0.0.1:5001/api/v0/pin/ls?type=all&stream=true',
    );
    expect(requestInit).toEqual({ method: 'POST' });
  });

  it('sends custom headers when provided', async () => {
    const fetchMock = vi.fn(async () => new Response(''));
    vi.stubGlobal('fetch', fetchMock);

    await countPinsViaRpc('http://127.0.0.1:5001', {
      Authorization: 'Bearer test',
    });

    const [, requestInit] = fetchMock.mock.calls[0]!;
    expect(requestInit).toEqual({
      method: 'POST',
      headers: { Authorization: 'Bearer test' },
    });
  });

  it('handles lines split across chunk boundaries', async () => {
    const body =
      '{"Cid":"QmA","Type":"recur' + 'sive"}\n{"Cid":"QmB","Type":"direct"}\n';
    const fetchMock = vi.fn(async () => new Response(body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(countPinsViaRpc('http://127.0.0.1:5001')).resolves.toEqual({
      direct: 1,
      recursive: 1,
      indirect: 0,
      total: 2,
    });
  });

  it('throws MeshkitError on HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );

    await expect(countPinsViaRpc('http://127.0.0.1:5001')).rejects.toBeInstanceOf(
      MeshkitError,
    );
  });
});
