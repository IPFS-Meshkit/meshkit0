import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as createClient from '../src/create-client.js';
import * as health from '../src/health.js';
import { Meshkit } from '../src/meshkit.js';
import { MeshkitError } from '../src/types.js';
import { createMockClient } from './helpers/mock-client.js';

describe('Meshkit.init', () => {
  it('throws when nodes array is empty', async () => {
    await expect(Meshkit.init({ nodes: [] })).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws when no nodes are healthy', async () => {
    vi.spyOn(createClient, 'createMeshkitClient').mockReturnValue(
      createMockClient({
        healthCheck: async () => {
          throw new Error('unreachable');
        },
      }),
    );

    await expect(
      Meshkit.init({ nodes: ['http://127.0.0.1:5001'] }),
    ).rejects.toMatchObject({
      name: 'MeshkitError',
      message: expect.stringContaining('No reachable nodes'),
    });
  });

  it('returns only healthy nodes', async () => {
    const healthy = createMockClient();
    vi.spyOn(createClient, 'createMeshkitClient')
      .mockReturnValueOnce(
        createMockClient({
          healthCheck: async () => {
            throw new Error('down');
          },
        }),
      )
      .mockReturnValueOnce(healthy);

    const mk = await Meshkit.init({
      nodes: ['http://bad:5001', 'http://good:5001'],
    });

    expect(mk.activeNodes).toEqual(['http://good:5001']);
  });

  it('forwards headers to createMeshkitClient', async () => {
    const createSpy = vi.spyOn(createClient, 'createMeshkitClient').mockReturnValue(
      createMockClient(),
    );

    await Meshkit.init({
      nodes: ['http://127.0.0.1:5001'],
      headers: { Authorization: 'Bearer test' },
    });

    expect(createSpy).toHaveBeenCalledWith({
      apiUrl: 'http://127.0.0.1:5001',
      headers: { Authorization: 'Bearer test' },
    });
  });
});

describe('Meshkit operations', () => {
  beforeEach(() => {
    vi.spyOn(createClient, 'createMeshkitClient').mockImplementation(() =>
      createMockClient(),
    );
  });

  it('upload fails over to the next node', async () => {
    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({
          upload: async () => {
            throw new Error('fail');
          },
        }),
        createMockClient({ upload: async () => 'QmOk' }),
      ],
      urls: ['http://a:5001', 'http://b:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({ nodes: ['http://a:5001', 'http://b:5001'] });
    await expect(mk.upload(new Uint8Array([1]))).resolves.toBe('QmOk');
  });

  it('retrieve fails over to the next node', async () => {
    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({
          retrieve: async () => {
            throw new Error('fail');
          },
        }),
        createMockClient({
          retrieve: async () => new Uint8Array([9]),
        }),
      ],
      urls: ['http://a:5001', 'http://b:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({ nodes: ['http://a:5001', 'http://b:5001'] });
    await expect(mk.retrieve('QmX')).resolves.toEqual(new Uint8Array([9]));
  });

  it('pin fails over to the next node', async () => {
    const pin = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [createMockClient({ pin }), createMockClient({ pin })],
      urls: ['http://a:5001', 'http://b:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({ nodes: ['http://a:5001', 'http://b:5001'] });
    await expect(mk.pin('QmX')).resolves.toBeUndefined();
    expect(pin).toHaveBeenCalledTimes(2);
  });

  it('publishName uses primary node only', async () => {
    const publish = vi.fn(async () => ({
      name: '/ipns/QmKey',
      value: '/ipfs/QmCid',
    }));
    const secondaryPublish = vi.fn();

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({ publishName: publish }),
        createMockClient({ publishName: secondaryPublish }),
      ],
      urls: ['http://primary:5001', 'http://secondary:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({
      nodes: ['http://primary:5001', 'http://secondary:5001'],
    });
    await mk.publishName('QmCid');

    expect(publish).toHaveBeenCalledOnce();
    expect(secondaryPublish).not.toHaveBeenCalled();
  });

  it('resolveName fails over to the next node', async () => {
    const resolveName = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('/ipfs/QmResolved');

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({ resolveName }),
        createMockClient({ resolveName }),
      ],
      urls: ['http://a:5001', 'http://b:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({ nodes: ['http://a:5001', 'http://b:5001'] });
    await expect(mk.resolveName('/ipns/k51Test')).resolves.toBe('/ipfs/QmResolved');
    expect(resolveName).toHaveBeenCalledTimes(2);
  });

  it('resolveAndRetrieve fails over to the next node', async () => {
    const resolveAndRetrieve = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(new Uint8Array([7]));

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({ resolveAndRetrieve }),
        createMockClient({ resolveAndRetrieve }),
      ],
      urls: ['http://a:5001', 'http://b:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({ nodes: ['http://a:5001', 'http://b:5001'] });
    await expect(mk.resolveAndRetrieve('/ipns/k51Test')).resolves.toEqual(
      new Uint8Array([7]),
    );
    expect(resolveAndRetrieve).toHaveBeenCalledTimes(2);
  });

  it('generateKey and listKeys use primary node only', async () => {
    const generateKey = vi.fn(async () => ({ id: 'k51Gen', name: 'docs' }));
    const listKeys = vi.fn(async () => [{ id: 'k51Self', name: 'self' }]);
    const secondaryGenerate = vi.fn();
    const secondaryList = vi.fn();

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({ generateKey, listKeys }),
        createMockClient({
          generateKey: secondaryGenerate,
          listKeys: secondaryList,
        }),
      ],
      urls: ['http://primary:5001', 'http://secondary:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({
      nodes: ['http://primary:5001', 'http://secondary:5001'],
    });

    await mk.generateKey('docs');
    await mk.listKeys();

    expect(generateKey).toHaveBeenCalledOnce();
    expect(listKeys).toHaveBeenCalledOnce();
    expect(secondaryGenerate).not.toHaveBeenCalled();
    expect(secondaryList).not.toHaveBeenCalled();
  });

  it('listPins uses primary node only', async () => {
    const listPins = vi.fn(async () => ['QmA', 'QmB']);
    const secondaryListPins = vi.fn();

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({ listPins }),
        createMockClient({ listPins: secondaryListPins }),
      ],
      urls: ['http://primary:5001', 'http://secondary:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({
      nodes: ['http://primary:5001', 'http://secondary:5001'],
    });

    await expect(mk.listPins()).resolves.toEqual(['QmA', 'QmB']);

    expect(listPins).toHaveBeenCalledOnce();
    expect(secondaryListPins).not.toHaveBeenCalled();
  });

  it('listPins passes pagination options to the primary client', async () => {
    const listPins = vi.fn(async () => ['QmB']);

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [createMockClient({ listPins })],
      urls: ['http://primary:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({ nodes: ['http://primary:5001'] });

    await expect(mk.listPins({ limit: 1, offset: 1 })).resolves.toEqual(['QmB']);
    expect(listPins).toHaveBeenCalledWith({ limit: 1, offset: 1 });
  });

  it('countPins uses primary node only', async () => {
    const countPins = vi.fn(
      async () => ({ direct: 0, recursive: 2, indirect: 1, total: 3 }),
    );
    const secondaryCountPins = vi.fn();

    vi.spyOn(health, 'filterHealthy').mockResolvedValue({
      clients: [
        createMockClient({ countPins }),
        createMockClient({ countPins: secondaryCountPins }),
      ],
      urls: ['http://primary:5001', 'http://secondary:5001'],
      failed: [],
    });

    const mk = await Meshkit.init({
      nodes: ['http://primary:5001', 'http://secondary:5001'],
    });

    await expect(mk.countPins()).resolves.toEqual({
      direct: 0,
      recursive: 2,
      indirect: 1,
      total: 3,
    });

    expect(countPins).toHaveBeenCalledOnce();
    expect(secondaryCountPins).not.toHaveBeenCalled();
  });
});
