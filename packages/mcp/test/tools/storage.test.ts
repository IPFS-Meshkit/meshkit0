import { describe, expect, it, vi } from 'vitest';
import { MeshkitError } from '@ipfs-meshkit/meshkit';
import type { MeshkitContext } from '../../src/context.js';
import { uploadSchema } from '../../src/schemas/storage.js';
import {
  handleListPins,
  handlePin,
  handlePinCount,
  handleRetrieve,
  handleUpload,
} from '../../src/tools/storage.js';

function createMockContext(): MeshkitContext {
  return {
    primaryNode: 'http://127.0.0.1:5001',
    meshkit: {
      activeNodes: ['http://127.0.0.1:5001'],
      upload: vi.fn().mockResolvedValue('QmUpload'),
      retrieve: vi.fn().mockResolvedValue(new TextEncoder().encode('hello')),
      pin: vi.fn().mockResolvedValue(undefined),
      publishName: vi.fn(),
      resolveName: vi.fn(),
      resolveAndRetrieve: vi.fn(),
      generateKey: vi.fn(),
      listKeys: vi.fn(),
      listPins: vi.fn().mockResolvedValue(['QmA', 'QmB']),
      countPins: vi
        .fn()
        .mockResolvedValue({ direct: 1, recursive: 2, indirect: 3, total: 6 }),
    },
  };
}

describe('storage tool handlers', () => {
  it('handleUpload uploads UTF-8 content and returns CID', async () => {
    const ctx = createMockContext();
    const result = await handleUpload(ctx, { content: 'hello' });

    // No password → called with (bytes, undefined)
    expect(ctx.meshkit.upload).toHaveBeenCalledWith(
      new TextEncoder().encode('hello'),
      undefined,
    );
    expect(result.content[0]?.text).toContain('QmUpload');
  });

  it('handleRetrieve returns text-encoded content', async () => {
    const ctx = createMockContext();
    const result = await handleRetrieve(ctx, { cid: 'QmTest' });

    // No password → called with (cid, undefined)
    expect(ctx.meshkit.retrieve).toHaveBeenCalledWith('QmTest', undefined);
    expect(result.content[0]?.text).toContain('"encoding": "text"');
    expect(result.content[0]?.text).toContain('hello');
  });

  it('handleUpload with password passes encrypt options', async () => {
    const ctx = createMockContext();
    await handleUpload(ctx, { content: 'secret', password: 'mypass' });

    expect(ctx.meshkit.upload).toHaveBeenCalledWith(
      new TextEncoder().encode('secret'),
      { encrypt: { password: 'mypass' } },
    );
  });

  it('handleUpload with password and custom iterations passes both', async () => {
    const ctx = createMockContext();
    await handleUpload(ctx, { content: 'secret', password: 'mypass', pbkdf2Iterations: 50_000 });

    expect(ctx.meshkit.upload).toHaveBeenCalledWith(
      new TextEncoder().encode('secret'),
      { encrypt: { password: 'mypass', iterations: 50_000 } },
    );
  });

  it('handleRetrieve with password passes decrypt options', async () => {
    const ctx = createMockContext();
    await handleRetrieve(ctx, { cid: 'QmEnc', password: 'mypass' });

    expect(ctx.meshkit.retrieve).toHaveBeenCalledWith('QmEnc', { password: 'mypass' });
  });

  it('handleUpload result includes encrypted: true when password is given', async () => {
    const ctx = createMockContext();
    const result = await handleUpload(ctx, { content: 'secret', password: 'mypass' });

    expect(result.content[0]?.text).toContain('"encrypted": true');
  });

  it('handleUpload result includes encrypted: false when no password is given', async () => {
    const ctx = createMockContext();
    const result = await handleUpload(ctx, { content: 'plain' });

    expect(result.content[0]?.text).toContain('"encrypted": false');
  });

  it('handlePin pins a CID', async () => {
    const ctx = createMockContext();
    const result = await handlePin(ctx, { cid: 'QmPin' });

    expect(ctx.meshkit.pin).toHaveBeenCalledWith('QmPin');
    expect(result.content[0]?.text).toContain('"pinned": true');
  });

  it('handleListPins lists pins from the primary node via meshkit', async () => {
    const ctx = createMockContext();

    const result = await handleListPins(ctx);

    expect(ctx.meshkit.listPins).toHaveBeenCalledWith({});
    expect(result.content[0]?.text).toContain('QmA');
    expect(result.content[0]?.text).toContain('QmB');
    expect(result.content[0]?.text).toContain('"count": 2');
  });

  it('handleListPins passes limit and offset through to meshkit', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.meshkit.listPins).mockResolvedValue(['QmB']);

    const result = await handleListPins(ctx, { limit: 1, offset: 1 });

    expect(ctx.meshkit.listPins).toHaveBeenCalledWith({ limit: 1, offset: 1 });
    expect(result.content[0]?.text).toContain('"limit": 1');
    expect(result.content[0]?.text).toContain('"offset": 1');
    expect(result.content[0]?.text).toContain('"count": 1');
  });

  it('handlePinCount returns counts by type without the pin list', async () => {
    const ctx = createMockContext();

    const result = await handlePinCount(ctx);

    expect(ctx.meshkit.countPins).toHaveBeenCalled();
    expect(result.content[0]?.text).toContain('"direct": 1');
    expect(result.content[0]?.text).toContain('"recursive": 2');
    expect(result.content[0]?.text).toContain('"indirect": 3');
    expect(result.content[0]?.text).toContain('"total": 6');
    expect(result.content[0]?.text).not.toContain('pins');
  });

  it('handleUpload surfaces MeshkitError messages', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.meshkit.upload).mockRejectedValue(
      new MeshkitError('No reachable nodes'),
    );

    await expect(handleUpload(ctx, { content: 'x' })).rejects.toThrow(
      /No reachable nodes/i,
    );
  });

  it('handleUpload accepts base64 input', async () => {
    const ctx = createMockContext();
    await handleUpload(ctx, { base64: 'aGVsbG8=' });

    expect(ctx.meshkit.upload).toHaveBeenCalledWith(
      new TextEncoder().encode('hello'),
      undefined,
    );
  });

  it('handleRetrieve returns base64 for binary content', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.meshkit.retrieve).mockResolvedValue(
      Uint8Array.from([0xff, 0xfe]),
    );

    const result = await handleRetrieve(ctx, { cid: 'QmBinary' });

    expect(result.content[0]?.text).toContain('"encoding": "base64"');
  });

  it('handleListPins returns an empty array', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.meshkit.listPins).mockResolvedValue([]);

    const result = await handleListPins(ctx);

    expect(result.content[0]?.text).toContain('"pins": []');
  });
});

describe('uploadSchema', () => {
  it('rejects empty input', () => {
    const result = uploadSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(
        /Either content or base64/i,
      );
    }
  });

  it('accepts text content', () => {
    expect(uploadSchema.safeParse({ content: 'hello' }).success).toBe(true);
  });

  it('accepts base64 content', () => {
    expect(uploadSchema.safeParse({ base64: 'aGVsbG8=' }).success).toBe(true);
  });
});
