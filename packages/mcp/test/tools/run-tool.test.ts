import { describe, expect, it, vi } from 'vitest';
import { MeshkitError } from '@ipfs-meshkit/meshkit';
import type { MeshkitContext } from '../../src/context.js';
import { runTool, runToolNoInput } from '../../src/tools/run-tool.js';
import { handleUpload } from '../../src/tools/storage.js';

function createMockContext(): MeshkitContext {
  return {
    primaryNode: 'http://127.0.0.1:5001',
    meshkit: {
      activeNodes: ['http://127.0.0.1:5001'],
      upload: vi.fn().mockResolvedValue('QmUpload'),
      retrieve: vi.fn(),
      pin: vi.fn(),
      publishName: vi.fn(),
      resolveName: vi.fn(),
      resolveAndRetrieve: vi.fn(),
      generateKey: vi.fn(),
      listKeys: vi.fn(),
      listPins: vi.fn(),
      countPins: vi.fn(),
    },
  };
}

describe('runTool', () => {
  it('returns MCP error result for validation failures', async () => {
    const ctx = createMockContext();
    const result = await runTool(ctx, handleUpload, {});

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Either content or base64/i);
    expect(ctx.meshkit.upload).not.toHaveBeenCalled();
  });

  it('returns MCP error result for MeshkitError', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.meshkit.upload).mockRejectedValue(
      new MeshkitError('No reachable nodes'),
    );

    const result = await runTool(ctx, handleUpload, { content: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No reachable nodes');
  });

  it('returns MCP error result for generic errors', async () => {
    const ctx = createMockContext();
    vi.mocked(ctx.meshkit.upload).mockRejectedValue(new Error('network down'));

    const result = await runTool(ctx, handleUpload, { content: 'hello' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('network down');
  });

  it('returns unknown error for non-Error throws', async () => {
    const ctx = createMockContext();
    const result = await runToolNoInput(ctx, async () => {
      throw 'boom';
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Unknown error');
  });
});
