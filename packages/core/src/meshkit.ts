import { createMeshkitClient } from './create-client.js';
import { filterHealthy } from './health.js';
import { withFailover, withPrimary } from './node-pool.js';
import { MeshkitError } from './types.js';
import type {
  IpnsKeyGenOptions,
  IpnsPublishOptions,
  IpnsResolveOptions,
} from './ipns/types.js';
import type {
  Meshkit as MeshkitFacade,
  MeshkitClient,
  MeshkitInitOptions,
  RetrieveOptions,
  StoredObject,
  UploadOptions,
} from './types.js';

export class Meshkit implements MeshkitFacade {
  readonly activeNodes: readonly string[];

  private readonly clients: MeshkitClient[];

  private constructor(clients: MeshkitClient[], urls: string[]) {
    this.clients = clients;
    this.activeNodes = Object.freeze([...urls]);
  }

  /**
   * Connect to one or more running Kubo nodes. Each node is health-checked;
   * unreachable nodes are dropped. Throws if no node is reachable.
   */
  static async init(options: MeshkitInitOptions): Promise<Meshkit> {
    if (options.nodes.length === 0) {
      throw new MeshkitError('At least one node URL is required');
    }

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

    return new Meshkit(healthy.clients, healthy.urls);
  }

  upload(data: Uint8Array, options?: UploadOptions): Promise<string> {
    return withFailover(this.clients, (client) => client.upload(data, options));
  }

  retrieve(cid: string, options?: RetrieveOptions): Promise<Uint8Array> {
    return withFailover(this.clients, (client) => client.retrieve(cid, options));
  }

  pin(cid: string): Promise<void> {
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

  listPins() {
    return withPrimary(this.clients, (client) => client.listPins());
  }

  list(): Promise<StoredObject[]> {
    throw new MeshkitError('list() is not supported on Kubo — use listPins() instead');
  }
}
