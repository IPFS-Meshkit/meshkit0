import { create } from 'kubo-rpc-client';
import { decrypt, encrypt, isEncryptedPayload } from './crypto.js';
import {
  extractCidFromPath,
  toIpfsPath,
  toIpnsPath,
} from './ipns/paths.js';
import type {
  IpnsKeyGenOptions,
  IpnsPublishOptions,
  IpnsResolveOptions,
} from './ipns/types.js';
import { countPinsViaRpc } from './pin-count.js';
import type { ListPinsOptions, MeshkitClient, MeshkitConfig, RetrieveOptions, StoredObject, UploadOptions } from './types.js';
import { MeshkitError } from './types.js';

function concatChunks(chunks: Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

export function createMeshkitClient(config: MeshkitConfig): MeshkitClient {
  const ipfs = create(
    config.headers
      ? { url: config.apiUrl, headers: config.headers }
      : { url: config.apiUrl },
  );

  async function resolveName(
    name: string,
    options?: IpnsResolveOptions,
  ): Promise<string> {
    const ipnsPath = toIpnsPath(name);
    let resolved = '';

    for await (const path of ipfs.name.resolve(ipnsPath, options)) {
      resolved = path;
    }

    if (!resolved) {
      throw new Error(`IPNS name not found or empty result: ${ipnsPath}`);
    }

    return resolved;
  }

  return {
    async upload(data: Uint8Array, options?: UploadOptions): Promise<string> {
      // Encrypt before sending to the node if requested.
      // The CID is computed by Kubo from the encrypted bytes.
      const payload = options?.encrypt
        ? await encrypt(data, options.encrypt)
        : data;
      const { cid } = await ipfs.add(payload, { pin: false });
      return cid.toString();
    },

    async retrieve(cid: string, options?: RetrieveOptions): Promise<Uint8Array> {
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      for await (const chunk of ipfs.cat(cid)) {
        chunks.push(chunk);
        totalLength += chunk.length;
      }

      const raw = concatChunks(chunks, totalLength);

      // Decrypt transparently if a password was supplied and the payload looks
      // like an EMSH encrypted blob.  If no password is given the raw bytes are
      // returned as-is (allowing callers to inspect or forward the ciphertext).
      if (options?.password && isEncryptedPayload(raw)) {
        return decrypt(raw, options.password);
      }
      return raw;
    },

    async pin(cid: string): Promise<void> {
      await ipfs.pin.add(cid);
    },

    async publishName(value: string, options?: IpnsPublishOptions) {
      const ipfsPath = toIpfsPath(value);
      const res = await ipfs.name.publish(ipfsPath, options);
      return { name: res.name, value: res.value };
    },

    resolveName,

    async resolveAndRetrieve(name: string, options?: IpnsResolveOptions) {
      const path = await resolveName(name, options);
      const cid = extractCidFromPath(path);
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      for await (const chunk of ipfs.cat(cid)) {
        chunks.push(chunk);
        totalLength += chunk.length;
      }

      return concatChunks(chunks, totalLength);
    },

    async generateKey(name: string, options?: IpnsKeyGenOptions) {
      const key = await ipfs.key.gen(name, options);
      return { id: key.id, name: key.name };
    },

    async listKeys() {
      const keys = await ipfs.key.list();
      return keys.map((key) => ({ id: key.id, name: key.name }));
    },

    async listPins(options?: ListPinsOptions): Promise<string[]> {
      const cids: string[] = [];
      const offset = options?.offset ?? 0;
      let skipped = 0;
      for await (const { cid } of ipfs.pin.ls({ type: 'all' })) {
        if (skipped < offset) {
          skipped++;
          continue;
        }
        cids.push(cid.toString());
        if (options?.limit !== undefined && cids.length >= options.limit) {
          break;
        }
      }
      return cids;
    },

    async countPins() {
      return countPinsViaRpc(config.apiUrl, config.headers);
    },

    list() {
      throw new MeshkitError('list() is not supported on Kubo — use listPins() instead');
    },

    async healthCheck(): Promise<void> {
      await ipfs.id();
    },
  };
}
