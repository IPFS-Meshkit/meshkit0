import { spawn, type ChildProcess } from 'node:child_process';
import { MeshkitNodeError, type IPFSNodeHandle, type StartIPFSNodeOptions } from './types.js';
import { isKuboHealthy, waitForKubo } from './health.js';
import { resolveRepoPath } from './repo.js';
import { ensureRepoConfigured } from './repo-config.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5001;
const DEFAULT_GATEWAY_PORT = 8080;
const DEFAULT_READY_TIMEOUT_MS = 30_000;

function buildApiUrl(host: string, port: number): string {
  return `http://${host}:${port}`;
}

async function assertIpfsBinary(binary: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ['--version'], { stdio: ['ignore', 'ignore', 'pipe'] });

    child.once('error', (error) => {
      reject(
        new MeshkitNodeError(
          `Kubo binary "${binary}" was not found. Install Kubo and ensure "ipfs" is on PATH.`,
          { cause: error },
        ),
      );
    });

    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new MeshkitNodeError(`Kubo binary "${binary}" exited with code ${code ?? 'unknown'}.`));
    });
  });
}

async function shutdownKubo(apiUrl: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v0/shutdown`, { method: 'POST' });
  if (!response.ok) {
    throw new MeshkitNodeError(`Failed to shut down Kubo at ${apiUrl} (HTTP ${response.status}).`);
  }
}

function spawnKuboDaemon(binary: string, options: { repo: string }): ChildProcess {
  return spawn(binary, ['daemon'], {
    env: { ...process.env, IPFS_PATH: options.repo },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function terminateChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);

    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill('SIGTERM');
  });
}

/**
 * Ensure a local Kubo daemon is running and return a handle to it.
 *
 * If a healthy daemon is already listening on the configured host/port, it is
 * reused (`managed: false`). Otherwise Meshkit spawns `ipfs daemon` and waits
 * for the RPC API to become ready (`managed: true`).
 */
export async function startIPFSNode(
  options: StartIPFSNodeOptions = {},
): Promise<IPFSNodeHandle> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const init = options.init ?? true;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  const ipfsBinary = options.ipfsBinary ?? 'ipfs';
  const gatewayPort = options.gatewayPort ?? DEFAULT_GATEWAY_PORT;
  const apiUrl = buildApiUrl(host, port);
  const repo = resolveRepoPath(options.repo);

  if (await isKuboHealthy(apiUrl)) {
    return {
      url: apiUrl,
      managed: false,
      async stop() {
        // Attached to an existing daemon — caller owns lifecycle.
      },
    };
  }

  await assertIpfsBinary(ipfsBinary);
  await ensureRepoConfigured(ipfsBinary, repo, host, port, gatewayPort, init);

  const child = spawnKuboDaemon(ipfsBinary, { repo });

  // If the host process exits for any reason (crash, process.exit), stop the
  // daemon spawned so it isn't left running as an orphan.
  const killOnExit = () => {
    child.kill();
  };
  process.once('exit', killOnExit);
  child.once('exit', () => {
    process.removeListener('exit', killOnExit);
  });

  let startupError: Error | undefined;

  child.stderr?.on('data', (chunk: Buffer) => {
    const message = chunk.toString();
    if (/error/i.test(message)) {
      startupError ??= new MeshkitNodeError(message.trim());
    }
  });

  child.once('error', (error) => {
    startupError = new MeshkitNodeError('Failed to start Kubo daemon.', { cause: error });
  });

  try {
    await waitForKubo(apiUrl, readyTimeoutMs);
  } catch (error) {
    await terminateChild(child);
    throw startupError ?? error;
  }

  if (startupError) {
    await terminateChild(child);
    throw startupError;
  }

  return {
    url: apiUrl,
    repo,
    managed: true,
    async stop() {
      try {
        await shutdownKubo(apiUrl);
      } catch {
        await terminateChild(child);
      }
    },
  };
}

/** Stop a node handle returned by {@link startIPFSNode}. */
export async function stopIPFSNode(handle: IPFSNodeHandle): Promise<void> {
  await handle.stop();
}
