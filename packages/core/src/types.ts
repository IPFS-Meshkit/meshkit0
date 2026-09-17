import type {
  IpnsKey,
  IpnsKeyGenOptions,
  IpnsPublishOptions,
  IpnsPublishResult,
  IpnsResolveOptions,
} from './ipns/types.js';
import type { EncryptOptions } from './crypto.js';

export type {
  IpnsDuration,
  IpnsKey,
  IpnsKeyGenOptions,
  IpnsPublishOptions,
  IpnsPublishResult,
  IpnsResolveOptions,
} from './ipns/types.js';

export type { EncryptOptions } from './crypto.js';

export class MeshkitError extends Error {
  /** The individual errors collected from each node that was tried. */
  readonly causes: Error[];

  constructor(message: string, causes: Error[] = []) {
    super(causes.length > 0 ? `${message}: ${causes.map((e) => e.message).join('; ')}` : message);
    this.name = 'MeshkitError';
    this.causes = causes;
  }
}

// ---------------------------------------------------------------------------
// Encryption option types
// ---------------------------------------------------------------------------

/**
 * Options controlling content encryption on upload.
 *
 * When provided, the raw bytes are encrypted with AES-256-GCM (key derived
 * via PBKDF2-SHA256) before being sent to the IPFS/S3 backend.  The CID is
 * therefore computed from the *encrypted* bytes, not the plaintext.
 *
 * **Important:** the CID is the only handle to your encrypted file.
 * It cannot be recomputed from the plaintext — store it alongside your
 * application metadata.
 */
export interface UploadOptions {
  /**
   * If set, content is encrypted with AES-256-GCM before uploading.
   * See {@link EncryptOptions} for details on the password and iteration count.
   */
  encrypt?: EncryptOptions;
}

/**
 * Options controlling content decryption on retrieve.
 *
 * If the retrieved bytes are an EMSH encrypted payload and a `password` is
 * provided, the payload is transparently decrypted before being returned.
 * If no password is provided, the raw (possibly encrypted) bytes are returned.
 */
export interface RetrieveOptions {
  /**
   * Password to decrypt the retrieved bytes.
   * Only used when the content is an EMSH encrypted payload
   * (as produced by an upload with `encrypt` options).
   * If the content is not encrypted this field is silently ignored.
   */
  password?: string;
}

export interface MeshkitConfig {
  /**
   * Kubo RPC API base URL for a running IPFS node.
   * Examples: `http://127.0.0.1:5001` (local) or `https://ipfs.example.com:5001` (VPS).
   */
  apiUrl: string;

  /**
   * Optional request headers (e.g. API auth configured on the node).
   */
  headers?: Record<string, string>;
}

export interface StoredObject {
  /** Content-addressed key (CID or custom key) identifying the object. */
  cid: string;
  /** Size of the object in bytes. */
  size: number;
  /** ISO 8601 timestamp of when the object was stored. */
  uploadedAt: string;
}

/**
 * Pin counts by type, as reported by Kubo `pin ls --type=all`.
 * `indirect` pins are deduplicated child blocks of recursive pins.
 */
export interface PinCount {
  /** Number of direct pins. */
  direct: number;
  /** Number of recursive pins (roots). */
  recursive: number;
  /** Number of indirect pins (children of recursive pins). */
  indirect: number;
  /** Sum of all pin types. */
  total: number;
}

/**
 * Pagination options for listing pins.
 * When `limit` is set, implementations stream and stop early instead of
 * materializing the full pinset — important on nodes with millions of pins.
 */
export interface ListPinsOptions {
  /** Maximum number of pinned CIDs to return. */
  limit?: number;
  /** Number of pins to skip before collecting results. */
  offset?: number;
}

export interface MeshkitClient {
  /**
   * Upload raw bytes to the connected IPFS node. Returns the CID string.
   * If `options.encrypt` is provided the bytes are encrypted before upload;
   * the CID identifies the encrypted blob, not the original plaintext.
   */
  upload(data: Uint8Array, options?: UploadOptions): Promise<string>;

  /**
   * Retrieve file contents from the connected IPFS node by CID.
   * If `options.password` is provided and the content is an EMSH encrypted
   * payload it is automatically decrypted before being returned.
   */
  retrieve(cid: string, options?: RetrieveOptions): Promise<Uint8Array>;

  /** Pin a CID on the connected IPFS node so it is not garbage-collected. */
  pin(cid: string): Promise<void>;

  /**
   * Publish an IPNS record pointing at a CID or `/ipfs/...` path.
   * Requires the node's private key (see `generateKey`). Does not pin content.
   */
  publishName(
    value: string,
    options?: IpnsPublishOptions,
  ): Promise<IpnsPublishResult>;

  /**
   * Resolve an IPNS name to a fully resolved `/ipfs/...` path.
   * No private key required — resolution is public.
   */
  resolveName(name: string, options?: IpnsResolveOptions): Promise<string>;

  /**
   * Resolve an IPNS name and retrieve the content bytes.
   * Composes `resolveName` then `retrieve`.
   */
  resolveAndRetrieve(
    name: string,
    options?: IpnsResolveOptions,
  ): Promise<Uint8Array>;

  /**
   * Create a named signing key in the node's keystore for stable IPNS names.
   */
  generateKey(name: string, options?: IpnsKeyGenOptions): Promise<IpnsKey>;

  /** List keys in the node's keystore (includes `"self"`). */
  listKeys(): Promise<IpnsKey[]>;

  /**
   * List pinned CIDs on the connected node.
   * When `options.limit` is set the pinset is streamed and iteration stops
   * early instead of materializing every pin.
   */
  listPins(options?: ListPinsOptions): Promise<string[]>;

  /**
   * Count pins by type on the connected node without returning the full list.
   * Streams the pinset and tallies counts — safe for very large pinsets.
   */
  countPins(): Promise<PinCount>;

  /**
   * List all stored objects with metadata.
   * Supported on S3-compatible backends (fil.one, Lighthouse, etc.).
   * Throws MeshkitError on Kubo — use listPins() instead.
   */
  list(): Promise<StoredObject[]>;

  /** Confirm the node's RPC API is reachable. Throws if it is not. */
  healthCheck(): Promise<void>;
}

export interface MeshkitInitOptions {
  /**
   * Kubo RPC API URLs for the IPFS nodes to connect to, in priority order.
   * The first node is the primary; later nodes are used for failover.
   * Examples: `http://127.0.0.1:5001` (local) or `https://node.example.com:5001` (VPS).
   */
  nodes: string[];

  /** Optional request headers sent to every node (e.g. API auth). */
  headers?: Record<string, string>;
}

export interface Meshkit {
  /**
   * Upload raw bytes, trying each healthy node in priority order.
   * If `options.encrypt` is provided the bytes are encrypted before upload.
   */
  upload(data: Uint8Array, options?: UploadOptions): Promise<string>;

  /**
   * Retrieve file contents by CID, trying each healthy node in priority order.
   * If `options.password` is provided and the content is encrypted it will be
   * transparently decrypted before being returned.
   */
  retrieve(cid: string, options?: RetrieveOptions): Promise<Uint8Array>;

  /** Pin a CID, trying each healthy node in priority order. */
  pin(cid: string): Promise<void>;

  /**
   * Publish an IPNS record on the primary node (owns the keystore).
   */
  publishName(
    value: string,
    options?: IpnsPublishOptions,
  ): Promise<IpnsPublishResult>;

  /**
   * Resolve an IPNS name, trying each healthy node in priority order.
   */
  resolveName(name: string, options?: IpnsResolveOptions): Promise<string>;

  /**
   * Resolve an IPNS name and retrieve bytes, with failover across healthy nodes.
   */
  resolveAndRetrieve(
    name: string,
    options?: IpnsResolveOptions,
  ): Promise<Uint8Array>;

  /**
   * Create a named signing key on the primary node.
   */
  generateKey(name: string, options?: IpnsKeyGenOptions): Promise<IpnsKey>;

  /** List keys on the primary node's keystore. */
  listKeys(): Promise<IpnsKey[]>;

  /** List pinned CIDs on the primary node (see `ListPinsOptions` for pagination). */
  listPins(options?: ListPinsOptions): Promise<string[]>;

  /** Count pins by type on the primary node without returning the full list. */
  countPins(): Promise<PinCount>;

  /**
   * List all stored objects with metadata.
   * Throws MeshkitError on Kubo — use listPins() instead.
   */
  list(): Promise<StoredObject[]>;

  /** Nodes that passed the health check at init, in priority order. */
  readonly activeNodes: readonly string[];
}
