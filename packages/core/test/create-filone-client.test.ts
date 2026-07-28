import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createFilOneClient, createS3Client } from '../src/create-filone-client.js';
import { createMeshkitClient } from '../src/create-client.js';
import { isEncryptedPayload } from '../src/crypto.js';
import { MeshkitError } from '../src/types.js';

const CONFIG = {
  accessKeyId: 'FHTESTACCESSKEYID',
  secretAccessKey: 'test-secret-key-value',
  bucket: 'test-bucket',
  endpoint: 'https://eu-west-1.s3.fil.one',
};

function makeResponse(status: number, body: BodyInit = ''): Response {
  return new Response(body, { status });
}

function makeListXml(objects: { key: string; size: number; lastModified: string }[], truncated = false, nextToken?: string): string {
  const contents = objects.map(o => `
    <Contents>
      <Key>${o.key}</Key>
      <Size>${o.size}</Size>
      <LastModified>${o.lastModified}</LastModified>
    </Contents>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
    <ListBucketResult>
      <IsTruncated>${truncated}</IsTruncated>
      ${contents}
      ${nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : ''}
    </ListBucketResult>`;
}

describe('createS3Client / createFilOneClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // ---------------------------------------------------------------------------
  // upload
  // ---------------------------------------------------------------------------
  describe('upload', () => {
    it('returns the CIDv1 of the uploaded bytes', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));
      const client = createFilOneClient(CONFIG);
      const cid = await client.upload(new TextEncoder().encode('hello filecoin'));
      expect(cid).toMatch(/^b[a-z2-7]+$/);
    });

    it('sends a signed PUT request to the correct URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
      vi.stubGlobal('fetch', fetchMock);
      const client = createFilOneClient(CONFIG);
      const data = new TextEncoder().encode('invoice data');
      const cid = await client.upload(data);
      const req = fetchMock.mock.calls[0][0] as Request;
      expect(req.url).toBe(`https://eu-west-1.s3.fil.one/test-bucket/${cid}`);
      expect(req.method).toBe('PUT');
    });

    it('throws MeshkitError when the server returns a non-2xx status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(403, 'AccessDenied')));
      const client = createFilOneClient(CONFIG);
      await expect(client.upload(new TextEncoder().encode('data'))).rejects.toBeInstanceOf(MeshkitError);
    });

    it('produces identical CIDs for identical content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));
      const client = createFilOneClient(CONFIG);
      const data = new TextEncoder().encode('same content');
      expect(await client.upload(data)).toBe(await client.upload(data));
    });

    it('produces different CIDs for different content', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));
      const client = createFilOneClient(CONFIG);
      const cid1 = await client.upload(new TextEncoder().encode('invoice-001'));
      const cid2 = await client.upload(new TextEncoder().encode('invoice-002'));
      expect(cid1).not.toBe(cid2);
    });

    // -------------------------------------------------------------------------
    // Encrypted upload
    // -------------------------------------------------------------------------

    it('encrypted upload sends EMSH blob (not plaintext) to S3', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
      vi.stubGlobal('fetch', fetchMock);

      const data = new TextEncoder().encode('secret invoice');
      const client = createFilOneClient(CONFIG);
      await client.upload(data, { encrypt: { password: 'pass', iterations: 1_000 } });

      // The body sent to S3 must be an encrypted EMSH payload
      const req = fetchMock.mock.calls[0][0] as Request;
      const body = new Uint8Array(await req.arrayBuffer());
      expect(isEncryptedPayload(body)).toBe(true);
      expect(body).not.toEqual(data);
    });

    it('two encrypted uploads of the same plaintext produce different CIDs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));
      const client = createFilOneClient(CONFIG);
      const data = new TextEncoder().encode('same secret');
      const opts = { encrypt: { password: 'pass', iterations: 1_000 } };
      const cid1 = await client.upload(data, opts);
      const cid2 = await client.upload(data, opts);
      // Different random salts → different ciphertexts → different CIDs
      expect(cid1).not.toBe(cid2);
    });
  });

  // ---------------------------------------------------------------------------
  // retrieve
  // ---------------------------------------------------------------------------
  describe('retrieve', () => {
    it('returns the bytes stored at the given CID', async () => {
      const original = new TextEncoder().encode('invoice payload');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(original.buffer)));
      const client = createFilOneClient(CONFIG);
      const result = await client.retrieve('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku');
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(original);
    });

    it('sends a signed GET request to the correct URL', async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array(4).buffer));
      vi.stubGlobal('fetch', fetchMock);
      const client = createFilOneClient(CONFIG);
      const cid = 'bafkreiabcdef';
      await client.retrieve(cid);
      const req = fetchMock.mock.calls[0][0] as Request;
      expect(req.url).toBe(`https://eu-west-1.s3.fil.one/test-bucket/${cid}`);
      expect(req.method).toBe('GET');
    });

    it('throws MeshkitError on 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(404, 'NoSuchKey')));
      const client = createFilOneClient(CONFIG);
      await expect(client.retrieve('bafkreimissing')).rejects.toBeInstanceOf(MeshkitError);
    });

    // -------------------------------------------------------------------------
    // Encrypted retrieve
    // -------------------------------------------------------------------------

    it('retrieve with correct password decrypts encrypted S3 content', async () => {
      const { encrypt } = await import('../src/crypto.js');
      const plaintext = new TextEncoder().encode('secret s3 payload');
      const encrypted = await encrypt(plaintext, { password: 'pass', iterations: 1_000 });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(encrypted.buffer)));
      const client = createFilOneClient(CONFIG);
      const result = await client.retrieve('bafkreiencrypted', { password: 'pass' });
      expect(result).toEqual(plaintext);
    });

    it('retrieve without password returns raw encrypted bytes', async () => {
      const { encrypt } = await import('../src/crypto.js');
      const plaintext = new TextEncoder().encode('secret s3 payload');
      const encrypted = await encrypt(plaintext, { password: 'pass', iterations: 1_000 });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(encrypted.buffer)));
      const client = createFilOneClient(CONFIG);
      const raw = await client.retrieve('bafkreiencrypted');
      expect(raw).toEqual(encrypted);
      expect(isEncryptedPayload(raw)).toBe(true);
    });

    it('retrieve with wrong password throws MeshkitError', async () => {
      const { encrypt } = await import('../src/crypto.js');
      const encrypted = await encrypt(
        new TextEncoder().encode('secret'),
        { password: 'correct', iterations: 1_000 },
      );

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(encrypted.buffer)));
      const client = createFilOneClient(CONFIG);
      await expect(
        client.retrieve('bafkreiencrypted', { password: 'wrong' }),
      ).rejects.toBeInstanceOf(MeshkitError);
    });

    it('retrieve with password on unencrypted content returns content unchanged', async () => {
      const original = new TextEncoder().encode('plain unencrypted content');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(original.buffer)));
      const client = createFilOneClient(CONFIG);
      const result = await client.retrieve('bafkreiplain', { password: 'pass' });
      // isEncryptedPayload returns false → content returned as-is
      expect(result).toEqual(original);
    });
  });

  // ---------------------------------------------------------------------------
  // pin
  // ---------------------------------------------------------------------------
  describe('pin', () => {
    it('silently succeeds (no-op)', async () => {
      const client = createFilOneClient(CONFIG);
      await expect(client.pin('bafkreiabcdef')).resolves.toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------
  describe('list', () => {
    it('returns StoredObjects for all CID keys with correct metadata', async () => {
      const enc = new TextEncoder();
      const data1 = enc.encode('invoice-alpha');
      const data2 = enc.encode('invoice-beta');

      // First two calls: PUTs for upload; third call: ListObjectsV2
      const uploadMock = vi.fn().mockResolvedValue(makeResponse(200));
      vi.stubGlobal('fetch', uploadMock);

      const client = createFilOneClient(CONFIG);
      const cid1 = await client.upload(data1);
      const cid2 = await client.upload(data2);

      const listXml = makeListXml([
        { key: cid1, size: data1.byteLength, lastModified: '2026-07-22T10:00:00.000Z' },
        { key: cid2, size: data2.byteLength, lastModified: '2026-07-22T11:00:00.000Z' },
      ]);
      uploadMock.mockResolvedValueOnce(makeResponse(200, listXml));

      const objects = await client.list();

      expect(objects).toHaveLength(2);
      const keys = objects.map((o) => o.cid);
      expect(keys).toContain(cid1);
      expect(keys).toContain(cid2);

      const obj1 = objects.find((o) => o.cid === cid1)!;
      expect(obj1.size).toBe(data1.byteLength);
      expect(() => new Date(obj1.uploadedAt)).not.toThrow();
      expect(new Date(obj1.uploadedAt).toISOString()).toBe(obj1.uploadedAt);
    });

    it('excludes keys that contain a dot (e.g. manifest.json)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        makeResponse(200, makeListXml([
          { key: 'bafkreigoodcid', size: 42, lastModified: '2026-07-22T10:00:00.000Z' },
          { key: 'manifest.json', size: 128, lastModified: '2026-07-22T09:00:00.000Z' },
        ]))
      ));
      const client = createFilOneClient(CONFIG);
      const objects = await client.list();
      expect(objects).toHaveLength(1);
      expect(objects[0].cid).toBe('bafkreigoodcid');
    });

    it('handles paginated results via IsTruncated + NextContinuationToken', async () => {
      const page1 = makeListXml(
        [{ key: 'bafkreipage1', size: 10, lastModified: '2026-07-22T10:00:00.000Z' }],
        true,
        'tok-abc',
      );
      const page2 = makeListXml(
        [{ key: 'bafkreipage2', size: 20, lastModified: '2026-07-22T11:00:00.000Z' }],
        false,
      );

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeResponse(200, page1))
        .mockResolvedValueOnce(makeResponse(200, page2));
      vi.stubGlobal('fetch', fetchMock);

      const client = createFilOneClient(CONFIG);
      const objects = await client.list();
      expect(objects).toHaveLength(2);
      expect(objects.map((o) => o.cid)).toEqual(['bafkreipage1', 'bafkreipage2']);
    });
  });

  // ---------------------------------------------------------------------------
  // listPins
  // ---------------------------------------------------------------------------
  describe('listPins', () => {
    it('returns the same CIDs as list().map(o => o.cid)', async () => {
      const cids = ['bafkreiaaa', 'bafkreibbb'];
      const listXml = makeListXml(
        cids.map((key) => ({ key, size: 10, lastModified: '2026-07-22T10:00:00.000Z' }))
      );

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(makeResponse(200, listXml))  // listPins call
        .mockResolvedValueOnce(makeResponse(200, listXml)); // list call
      vi.stubGlobal('fetch', fetchMock);

      const client = createFilOneClient(CONFIG);
      const pins = await client.listPins();
      const listCids = (await client.list()).map((o) => o.cid);

      expect(pins).toEqual(listCids);
    });
  });

  // ---------------------------------------------------------------------------
  // healthCheck
  // ---------------------------------------------------------------------------
  describe('healthCheck', () => {
    it('resolves when the bucket HEAD returns 200', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200)));
      await expect(createFilOneClient(CONFIG).healthCheck()).resolves.toBeUndefined();
    });

    it('resolves when the bucket HEAD returns 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(404)));
      await expect(createFilOneClient(CONFIG).healthCheck()).resolves.toBeUndefined();
    });

    it('throws MeshkitError on 403 (bad credentials)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(403)));
      await expect(createFilOneClient(CONFIG).healthCheck()).rejects.toBeInstanceOf(MeshkitError);
    });
  });

  // ---------------------------------------------------------------------------
  // unsupported IPNS / key operations
  // ---------------------------------------------------------------------------
  describe('unsupported IPNS / key operations', () => {
    it.each([
      ['publishName', (c: ReturnType<typeof createFilOneClient>) => c.publishName('/ipfs/abc')],
      ['resolveName', (c: ReturnType<typeof createFilOneClient>) => c.resolveName('k51abc')],
      ['resolveAndRetrieve', (c: ReturnType<typeof createFilOneClient>) => c.resolveAndRetrieve('k51abc')],
      ['generateKey', (c: ReturnType<typeof createFilOneClient>) => c.generateKey('my-key')],
      ['listKeys', (c: ReturnType<typeof createFilOneClient>) => c.listKeys()],
    ])('%s throws MeshkitError', async (_name, call) => {
      const client = createFilOneClient(CONFIG);
      await expect(call(client)).rejects.toBeInstanceOf(MeshkitError);
    });
  });

  // ---------------------------------------------------------------------------
  // list() on Kubo client throws
  // ---------------------------------------------------------------------------
  describe('list() on Kubo client', () => {
    it('throws MeshkitError', () => {
      const client = createMeshkitClient({ apiUrl: 'http://127.0.0.1:5001' });
      expect(() => client.list()).toThrow(MeshkitError);
    });
  });

  // ---------------------------------------------------------------------------
  // createFilOneClient defaults
  // ---------------------------------------------------------------------------
  describe('createFilOneClient defaults', () => {
    it('uses eu-west-1.s3.fil.one when no endpoint is provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
      vi.stubGlobal('fetch', fetchMock);
      const client = createFilOneClient({
        accessKeyId: CONFIG.accessKeyId,
        secretAccessKey: CONFIG.secretAccessKey,
        bucket: CONFIG.bucket,
      });
      const cid = await client.upload(new TextEncoder().encode('default endpoint test'));
      const req = fetchMock.mock.calls[0][0] as Request;
      expect(req.url).toContain('eu-west-1.s3.fil.one');
      expect(req.url).toContain(cid);
    });

    it('strips a trailing slash from a custom endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
      vi.stubGlobal('fetch', fetchMock);
      const client = createFilOneClient({ ...CONFIG, endpoint: 'https://eu-west-1.s3.fil.one/' });
      await client.upload(new TextEncoder().encode('trailing slash'));
      const req = fetchMock.mock.calls[0][0] as Request;
      expect(req.url).not.toContain('//test-bucket');
    });
  });

  // ---------------------------------------------------------------------------
  // createS3Client with a custom endpoint
  // ---------------------------------------------------------------------------
  describe('createS3Client', () => {
    it('uses the provided custom endpoint', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(200));
      vi.stubGlobal('fetch', fetchMock);
      const client = createS3Client({
        accessKeyId: 'key',
        secretAccessKey: 'secret',
        bucket: 'my-bucket',
        endpoint: 'https://gateway.lighthouse.storage',
      });
      const cid = await client.upload(new TextEncoder().encode('lighthouse test'));
      const req = fetchMock.mock.calls[0][0] as Request;
      expect(req.url).toContain('gateway.lighthouse.storage');
      expect(req.url).toContain(cid);
    });
  });
});
