import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isEncryptedPayload } from '../src/crypto.js';
import { MeshkitError } from '../src/types.js';

const ipfs = {
  add: vi.fn(),
  cat: vi.fn(),
  pin: { add: vi.fn(), ls: vi.fn() },
  id: vi.fn(),
  name: {
    publish: vi.fn(),
    resolve: vi.fn(),
  },
  key: {
    gen: vi.fn(),
    list: vi.fn(),
  },
};

vi.mock('kubo-rpc-client', () => ({
  create: vi.fn(() => ipfs),
}));

import { create } from 'kubo-rpc-client';
import { createMeshkitClient } from '../src/create-client.js';

/** A fixed plaintext for upload/retrieve tests. */
const PLAINTEXT = new TextEncoder().encode('hello meshkit');
const PASSWORD = 'test-password-32chars-minimum-ok';

describe('createMeshkitClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes custom headers to kubo-rpc-client', () => {
    createMeshkitClient({
      apiUrl: 'http://127.0.0.1:5001',
      headers: { Authorization: 'Bearer test' },
    });

    expect(create).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:5001',
      headers: { Authorization: 'Bearer test' },
    });
  });

  // ---------------------------------------------------------------------------
  // upload — unencrypted (backward compat)
  // ---------------------------------------------------------------------------

  it('upload returns the CID string from Kubo', async () => {
    ipfs.add.mockResolvedValue({ cid: { toString: () => 'QmUpload' } });

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await expect(client.upload(new Uint8Array([1, 2]))).resolves.toBe('QmUpload');
    expect(ipfs.add).toHaveBeenCalledWith(new Uint8Array([1, 2]), { pin: false });
  });

  // ---------------------------------------------------------------------------
  // upload — encrypted
  // ---------------------------------------------------------------------------

  it('upload with encrypt option passes encrypted bytes to Kubo (not plaintext)', async () => {
    ipfs.add.mockResolvedValue({ cid: { toString: () => 'QmEncrypted' } });

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    const cid = await client.upload(PLAINTEXT, {
      encrypt: { password: PASSWORD, iterations: 1 },
    });

    expect(cid).toBe('QmEncrypted');

    // The bytes actually sent to Kubo must NOT be the original plaintext
    const sentBytes: Uint8Array = ipfs.add.mock.calls[0][0] as Uint8Array;
    expect(sentBytes).not.toEqual(PLAINTEXT);

    // They must look like an EMSH encrypted payload
    expect(isEncryptedPayload(sentBytes)).toBe(true);
  });

  it('two encrypted uploads of the same plaintext produce different blobs', async () => {
    ipfs.add.mockResolvedValue({ cid: { toString: () => 'QmAny' } });
    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    const opts = { encrypt: { password: PASSWORD, iterations: 1 } };

    await client.upload(PLAINTEXT, opts);
    await client.upload(PLAINTEXT, opts);

    const blob1: Uint8Array = ipfs.add.mock.calls[0][0] as Uint8Array;
    const blob2: Uint8Array = ipfs.add.mock.calls[1][0] as Uint8Array;

    expect(Buffer.from(blob1).toString('hex')).not.toBe(
      Buffer.from(blob2).toString('hex'),
    );
  });

  // ---------------------------------------------------------------------------
  // retrieve — unencrypted (backward compat)
  // ---------------------------------------------------------------------------

  it('retrieve concatenates streamed chunks', async () => {
    async function* chunks() {
      yield new Uint8Array([1, 2]);
      yield new Uint8Array([3]);
    }
    ipfs.cat.mockReturnValue(chunks());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await expect(client.retrieve('QmX')).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('retrieve without password returns raw encrypted bytes when content is encrypted', async () => {
    // Simulate: upload encrypted, then retrieve without password
    const { encrypt } = await import('../src/crypto.js');
    const encrypted = await encrypt(PLAINTEXT, { password: PASSWORD, iterations: 1 });

    async function* chunks() { yield encrypted; }
    ipfs.cat.mockReturnValue(chunks());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    const raw = await client.retrieve('QmEnc');
    // Should return the raw encrypted blob, not the plaintext
    expect(raw).toEqual(encrypted);
    expect(isEncryptedPayload(raw)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // retrieve — decrypted
  // ---------------------------------------------------------------------------

  it('retrieve with correct password decrypts transparently', async () => {
    const { encrypt } = await import('../src/crypto.js');
    const encrypted = await encrypt(PLAINTEXT, { password: PASSWORD, iterations: 1 });

    async function* chunks() { yield encrypted; }
    ipfs.cat.mockReturnValue(chunks());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    const result = await client.retrieve('QmEnc', { password: PASSWORD });

    expect(result).toEqual(PLAINTEXT);
  });

  it('retrieve with wrong password throws MeshkitError', async () => {
    const { encrypt } = await import('../src/crypto.js');
    const encrypted = await encrypt(PLAINTEXT, { password: PASSWORD, iterations: 1 });

    async function* chunks() { yield encrypted; }
    ipfs.cat.mockReturnValue(chunks());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await expect(
      client.retrieve('QmEnc', { password: 'wrong-password' }),
    ).rejects.toBeInstanceOf(MeshkitError);
  });

  it('retrieve with password on plaintext content returns plaintext unchanged', async () => {
    // If the content is NOT encrypted, providing a password should be a no-op
    async function* chunks() { yield PLAINTEXT; }
    ipfs.cat.mockReturnValue(chunks());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    const result = await client.retrieve('QmPlain', { password: PASSWORD });

    // isEncryptedPayload returns false → raw bytes returned as-is
    expect(result).toEqual(PLAINTEXT);
  });

  // ---------------------------------------------------------------------------
  // IPNS + key methods (unchanged)
  // ---------------------------------------------------------------------------

  it('publishName prefixes values with /ipfs/', async () => {
    ipfs.name.publish.mockResolvedValue({
      name: 'k51Test',
      value: '/ipfs/QmDoc',
    });

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    const result = await client.publishName('QmDoc', { key: 'docs' });

    expect(ipfs.name.publish).toHaveBeenCalledWith('/ipfs/QmDoc', { key: 'docs' });
    expect(result).toEqual({ name: 'k51Test', value: '/ipfs/QmDoc' });
  });

  it('resolveName returns the last resolved path', async () => {
    async function* paths() {
      yield '/ipfs/QmFirst';
      yield '/ipfs/QmFinal';
    }
    ipfs.name.resolve.mockReturnValue(paths());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await expect(client.resolveName('k51Test', { nocache: true })).resolves.toBe(
      '/ipfs/QmFinal',
    );
    expect(ipfs.name.resolve).toHaveBeenCalledWith('/ipns/k51Test', { nocache: true });
  });

  it('resolveAndRetrieve follows IPNS to content', async () => {
    async function* paths() {
      yield '/ipfs/QmDoc';
    }
    ipfs.name.resolve.mockReturnValue(paths());

    async function* chunks() {
      yield new Uint8Array([4, 5]);
    }
    ipfs.cat.mockReturnValue(chunks());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await expect(client.resolveAndRetrieve('k51Test')).resolves.toEqual(
      new Uint8Array([4, 5]),
    );
    expect(ipfs.cat).toHaveBeenCalledWith('QmDoc');
  });

  it('generateKey and listKeys map Kubo key records', async () => {
    ipfs.key.gen.mockResolvedValue({ id: 'k51Gen', name: 'docs' });
    ipfs.key.list.mockResolvedValue([{ id: 'k51Self', name: 'self' }]);

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await expect(client.generateKey('docs', { type: 'rsa' })).resolves.toEqual({
      id: 'k51Gen',
      name: 'docs',
    });
    await expect(client.listKeys()).resolves.toEqual([{ id: 'k51Self', name: 'self' }]);
  });

  it('listPins collects streamed pin ls results', async () => {
    async function* pins() {
      yield {
        cid: { toString: () => 'QmA' },
        type: 'recursive',
      };
      yield {
        cid: { toString: () => 'QmB' },
        type: 'recursive',
      };
    }
    ipfs.pin.ls.mockReturnValue(pins());

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await expect(client.listPins()).resolves.toEqual(['QmA', 'QmB']);
    expect(ipfs.pin.ls).toHaveBeenCalledWith({ type: 'all' });
  });

  it('healthCheck calls ipfs.id()', async () => {
    ipfs.id.mockResolvedValue({});

    const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
    await client.healthCheck();

    expect(ipfs.id).toHaveBeenCalledOnce();
  });
});
