import { AwsClient } from 'aws4fetch';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import * as raw from 'multiformats/codecs/raw';
import { decrypt, encrypt, isEncryptedPayload } from './crypto.js';
import { MeshkitError } from './types.js';
import type { MeshkitClient, RetrieveOptions, StoredObject, UploadOptions } from './types.js';

export interface S3StorageConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * Any S3-compatible endpoint.
   * Examples:
   *   fil.one:    https://us-east-1.s3.fil.one
   *   Lighthouse: https://gateway.lighthouse.storage
   */
  endpoint: string;
}

/**
 * Configuration for a fil.one S3-compatible storage bucket.
 *
 * Get your access key at https://app.fil.one → API Keys → Create Key.
 * The endpoint format is: https://<region>.s3.fil.one
 */
export interface FilOneConfig {
  /** fil.one access key ID (format: FHXXXXXXXXXXXXXXXX). */
  accessKeyId: string;

  /** fil.one secret access key. Shown only once at key creation. */
  secretAccessKey: string;

  /** Target bucket name, created in the fil.one dashboard. */
  bucket: string;

  /**
   * S3 endpoint for your fil.one region.
   * @default "https://eu-west-1.s3.fil.one"
   */
  endpoint?: string;
}

async function computeCid(data: Uint8Array): Promise<string> {
  const hash = await sha256.digest(data);
  return CID.create(1, raw.code, hash).toString();
}

const NOT_SUPPORTED = (op: string) => (): Promise<never> =>
  Promise.reject(
    new MeshkitError(
      `${op} is not supported on S3-compatible backends — object stores have no IPFS keystore or pinning layer`,
    ),
  );

/**
 * Create a MeshkitClient backed by any S3-compatible object store
 * (fil.one, Lighthouse, Filebase, 4EVERLAND, Akave, ChainSafe, …)
 * instead of a Kubo node.
 *
 * Files are stored at <endpoint>/<bucket>/<cidv1> where the CID is computed
 * locally from the raw bytes — no IPFS daemon required.
 *
 * @example
 * ```ts
 * const client = createS3Client({
 *   accessKeyId: process.env.STORAGE_KEY!,
 *   secretAccessKey: process.env.STORAGE_SECRET!,
 *   bucket: 'my-bucket',
 *   endpoint: 'https://<your-s3-compatible-endpoint>',
 * });
 * ```
 */
export function createS3Client(config: S3StorageConfig): MeshkitClient {
  const endpoint = config.endpoint.replace(/\/$/, '');
  const { bucket } = config;

  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: 's3',
  });

  function objectUrl(key: string): string {
    return `${endpoint}/${bucket}/${key}`;
  }

  async function listAllObjects(): Promise<{ key: string; size: number; lastModified: Date | undefined }[]> {
    const results: { key: string; size: number; lastModified: Date | undefined }[] = [];
    let continuationToken: string | undefined;

    do {
      const url = new URL(`${endpoint}/${bucket}`);
      url.searchParams.set('list-type', '2');
      if (continuationToken) {
        url.searchParams.set('continuation-token', continuationToken);
      }

      const res = await aws.fetch(url.toString(), { method: 'GET' });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new MeshkitError(
          `S3 list failed [${res.status}]: ${body || res.statusText}`,
        );
      }

      const xml = await res.text();

      // Parse <Contents> entries from S3 ListObjectsV2 XML response
      const contentsMatches = xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g);
      for (const match of contentsMatches) {
        const block = match[1] ?? '';
        const key = block.match(/<Key>(.*?)<\/Key>/)?.[1];
        const sizeStr = block.match(/<Size>(.*?)<\/Size>/)?.[1] ?? '0';
        const lastModStr = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1];

        if (!key) continue;
        // Skip non-CID keys (anything containing a dot, e.g. manifest.json)
        if (key.includes('.')) continue;

        results.push({
          key,
          size: parseInt(sizeStr, 10),
          lastModified: lastModStr ? new Date(lastModStr) : undefined,
        });
      }

      const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      const nextToken = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/)?.[1];
      continuationToken = isTruncated ? nextToken : undefined;
    } while (continuationToken);

    return results;
  }

  return {
    async upload(data: Uint8Array, options?: UploadOptions): Promise<string> {
      // Encrypt before computing the CID if requested.
      // The CID is derived from the encrypted bytes — different passwords on
      // the same plaintext will produce different CIDs (by design).
      const payload = options?.encrypt
        ? await encrypt(data, options.encrypt)
        : data;

      const cid = await computeCid(payload);
      const res = await aws.fetch(objectUrl(cid), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload.buffer as BodyInit,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new MeshkitError(
          `S3 upload failed [${res.status}]: ${body || res.statusText}`,
        );
      }

      return cid;
    },

    async retrieve(cid: string, options?: RetrieveOptions): Promise<Uint8Array> {
      const res = await aws.fetch(objectUrl(cid), { method: 'GET' });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new MeshkitError(
          `S3 retrieve failed [${res.status}] for CID ${cid}: ${body || res.statusText}`,
        );
      }

      const raw = new Uint8Array(await res.arrayBuffer());

      // Decrypt transparently if a password was supplied and the payload looks
      // like an EMSH encrypted blob.
      if (options?.password && isEncryptedPayload(raw)) {
        return decrypt(raw, options.password);
      }
      return raw;
    },

    async pin(_cid: string): Promise<void> {},

    async listPins(): Promise<string[]> {
      const objects = await listAllObjects();
      return objects.map((o) => o.key);
    },

    async list(): Promise<StoredObject[]> {
      const objects = await listAllObjects();
      return objects.map((o) => ({
        cid: o.key,
        size: o.size,
        uploadedAt: o.lastModified?.toISOString() ?? '',
      }));
    },

    publishName: NOT_SUPPORTED('publishName'),
    resolveName: NOT_SUPPORTED('resolveName'),
    resolveAndRetrieve: NOT_SUPPORTED('resolveAndRetrieve'),
    generateKey: NOT_SUPPORTED('generateKey'),
    listKeys: NOT_SUPPORTED('listKeys'),

    async healthCheck(): Promise<void> {
      const res = await aws.fetch(`${endpoint}/${bucket}`, { method: 'HEAD' });
      if (!res.ok && res.status !== 404) {
        throw new MeshkitError(
          `S3 health check failed [${res.status}]: verify accessKeyId, secretAccessKey, and bucket name`,
        );
      }
    },
  };
}

/**
 * Create a MeshkitClient backed by fil.one (Filecoin-native S3-compatible
 * object storage). This is a thin preset over `createS3Client` — the only
 * difference is that `endpoint` defaults to `https://eu-west-1.s3.fil.one`.
 *
 * @example
 * ```ts
 * import { createFilOneClient } from '@ipfs-meshkit/meshkit';
 *
 * const client = createFilOneClient({
 *   accessKeyId: process.env.FIL_ACCESS_KEY!,
 *   secretAccessKey: process.env.FIL_SECRET_KEY!,
 *   bucket: 'my-invoices',
 * });
 *
 * const cid = await client.upload(data);
 * const bytes = await client.retrieve(cid);
 * ```
 */
export function createFilOneClient(config: FilOneConfig): MeshkitClient {
  return createS3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint: config.endpoint ?? 'https://eu-west-1.s3.fil.one',
  });
}
