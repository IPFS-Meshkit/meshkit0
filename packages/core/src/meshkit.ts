import { createMeshkitClient } from './create-client.js';
import { assertGatedAccess } from './gated-access/assert.js';
import { filterHealthy } from './health.js';
import { withFailover, withPrimary } from './node-pool.js';
import { MeshkitError } from './types.js';
import type {
  IpnsKeyGenOptions,
  IpnsPublishOptions,
  IpnsResolveOptions,
} from './ipns/types.js';
import type {
  ListPinsOptions,
  Meshkit as MeshkitFacade,
  MeshkitClient,
  MeshkitGatedAccessConfig,
  MeshkitInitOptions,
  RetrieveOptions,
  StoredObject,
  UploadOptions,
} from './types.js';

export class Meshkit implements MeshkitFacade {
  readonly activeNodes: readonly string[];

  private readonly clients: MeshkitClient[];
  private readonly gatedAccess: MeshkitGatedAccessConfig | undefined;

  private constructor(
    clients: MeshkitClient[],
    urls: string[],
    gatedAccess?: MeshkitGatedAccessConfig,
  ) {
    this.clients = clients;
    this.activeNodes = Object.freeze([...urls]);
    this.gatedAccess = gatedAccess;
  }

  /**
   * Connect to one or more running Kubo nodes. Each node is health-checked;
   * unreachable nodes are dropped. Throws if no node is reachable.
   *
   * Optional `gatedAccess` is asserted once per upload / retrieve / pin
   * before failover (so a retry does not charge PPT twice).
   */
  static async init(options: MeshkitInitOptions): Promise<Meshkit> {
    if (options.nodes.length === 0) {
      throw new MeshkitError('At least one node URL is required');
    }

    // Do not pass gatedAccess into per-node clients — the facade charges once.
    const clients = options.nodes.map((url) =>
      options.headers
        ? createMeshkitClient({ apiUrl: url, headers: options.headers })
        : createMeshkitClient({ apiUrl: url }),
    );

    const healthy = await filterHealthy(clients, options.nodes);

    if (healthy.clients.length === 0) {
      throw new MeshkitError(
        `No reachable nodes (tried: ${options.nodes.join(', ')})`,
      );
    }

    return new Meshkit(healthy.clients, healthy.urls, options.gatedAccess);
  }

  async upload(data: Uint8Array, options?: UploadOptions): Promise<string> {
    await assertGatedAccess(this.gatedAccess, 'upload');
    return withFailover(this.clients, (client) => client.upload(data, options));
  }

  async retrieve(cid: string, options?: RetrieveOptions): Promise<Uint8Array> {
    await assertGatedAccess(this.gatedAccess, 'retrieve');
    return withFailover(this.clients, (client) => client.retrieve(cid, options));
  }

  async pin(cid: string): Promise<void> {
    await assertGatedAccess(this.gatedAccess, 'pin');
    return withFailover(this.clients, (client) => client.pin(cid));
  }

  publishName(value: string, options?: IpnsPublishOptions) {
    return withPrimary(this.clients, (client) =>
      client.publishName(value, options),
    );
  }

  resolveName(name: string, options?: IpnsResolveOptions) {
    return withFailover(this.clients, (client) =>
      client.resolveName(name, options),
    );
  }

  resolveAndRetrieve(name: string, options?: IpnsResolveOptions) {
    return withFailover(this.clients, (client) =>
      client.resolveAndRetrieve(name, options),
    );
  }

  generateKey(name: string, options?: IpnsKeyGenOptions) {
    return withPrimary(this.clients, (client) =>
      client.generateKey(name, options),
    );
  }

  listKeys() {
    return withPrimary(this.clients, (client) => client.listKeys());
  }

  listPins(options?: ListPinsOptions) {
    return withPrimary(this.clients, (client) => client.listPins(options));
  }

  countPins() {
    return withPrimary(this.clients, (client) => client.countPins());
  }

  list(): Promise<StoredObject[]> {
    throw new MeshkitError('list() is not supported on Kubo — use listPins() instead');
  }
}
