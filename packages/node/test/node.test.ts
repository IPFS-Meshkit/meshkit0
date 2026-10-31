import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';

const { isKuboHealthy, waitForKubo } = vi.hoisted(() => ({
  isKuboHealthy: vi.fn(),
  waitForKubo: vi.fn(),
}));

const { ensureRepoConfigured } = vi.hoisted(() => ({
  ensureRepoConfigured: vi.fn(),
}));

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn(),
}));

vi.mock('../src/health.js', () => ({
  isKuboHealthy,
  waitForKubo,
}));

vi.mock('../src/repo-config.js', () => ({
  ensureRepoConfigured,
}));

vi.mock('node:child_process', () => ({
  spawn,
}));

import { startIPFSNode, stopIPFSNode } from '../src/node.js';

function mockChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  const kill = vi.fn((signal?: NodeJS.Signals | number) => {
    queueMicrotask(() => child.emit('exit', 0, signal));
  });
  Object.assign(child, {
    stderr: new EventEmitter(),
    stdout: new EventEmitter(),
    kill,
    exitCode: null,
    signalCode: null,
  });
  return child;
}

function mockManagedNodeSpawn(child: ChildProcess): void {
  spawn
    .mockImplementationOnce((_cmd, args) => {
      expect(args).toEqual(['--version']);
      const versionChild = mockChildProcess();
      queueMicrotask(() => versionChild.emit('exit', 0));
      return versionChild;
    })
    .mockImplementationOnce((_cmd, args) => {
      expect(args).toEqual(['daemon']);
      return child;
    });
}

describe('startIPFSNode', () => {
  beforeEach(() => {
    isKuboHealthy.mockReset();
    waitForKubo.mockReset();
    ensureRepoConfigured.mockReset();
    spawn.mockReset();
  });

  it('attaches to an existing healthy daemon without spawning', async () => {
    isKuboHealthy.mockResolvedValue(true);

    const handle = await startIPFSNode({ port: 5001 });

    expect(handle.managed).toBe(false);
    expect(handle.url).toBe('http://127.0.0.1:5001');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawns Kubo when the API is not healthy', async () => {
    isKuboHealthy.mockResolvedValue(false);
    waitForKubo.mockResolvedValue(undefined);
    ensureRepoConfigured.mockResolvedValue(undefined);

    const child = mockChildProcess();
    mockManagedNodeSpawn(child);

    const handle = await startIPFSNode({
      repo: '/tmp/meshkit-test-ipfs',
      port: 15_099,
      gatewayPort: 18_099,
    });

    expect(handle.managed).toBe(true);
    expect(handle.repo).toContain('meshkit-test-ipfs');
    expect(ensureRepoConfigured).toHaveBeenCalledOnce();
    expect(waitForKubo).toHaveBeenCalledWith('http://127.0.0.1:15099', 30_000);
  });

  it('stop() calls the Kubo shutdown API for managed nodes', async () => {
    isKuboHealthy.mockResolvedValue(false);
    waitForKubo.mockResolvedValue(undefined);
    ensureRepoConfigured.mockResolvedValue(undefined);

    const child = mockChildProcess();
    mockManagedNodeSpawn(child);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
      })),
    );

    const handle = await startIPFSNode({
      repo: '/tmp/meshkit-stop-test',
      port: 15_098,
      gatewayPort: 18_098,
    });

    await handle.stop();

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:15098/api/v0/shutdown', {
      method: 'POST',
    });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('stop() terminates the child when the shutdown API fails', async () => {
    isKuboHealthy.mockResolvedValue(false);
    waitForKubo.mockResolvedValue(undefined);
    ensureRepoConfigured.mockResolvedValue(undefined);

    const child = mockChildProcess();
    mockManagedNodeSpawn(child);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
      })),
    );

    const handle = await startIPFSNode({
      repo: '/tmp/meshkit-stop-fallback-test',
      port: 15_097,
      gatewayPort: 18_097,
    });

    await handle.stop();

    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:15097/api/v0/shutdown', {
      method: 'POST',
    });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

describe('startIPFSNode exit cleanup', () => {
  beforeEach(() => {
    isKuboHealthy.mockReset();
    waitForKubo.mockReset();
    ensureRepoConfigured.mockReset();
    spawn.mockReset();
  });

  function newExitListeners(before: Function[]): Function[] {
    return process.listeners('exit').filter((l) => !before.includes(l));
  }

  it('kills a managed daemon when the host process exits', async () => {
    isKuboHealthy.mockResolvedValue(false);
    waitForKubo.mockResolvedValue(undefined);
    ensureRepoConfigured.mockResolvedValue(undefined);
    const child = mockChildProcess();
    mockManagedNodeSpawn(child);
    const before = process.listeners('exit');

    await startIPFSNode({ repo: '/tmp/meshkit-exit-test', port: 15_096, gatewayPort: 18_096 });

    const added = newExitListeners(before);
    expect(added).toHaveLength(1);
    added[0]!(1);
    expect(child.kill).toHaveBeenCalled();
  });

  it('removes the exit hook once the daemon has exited', async () => {
    isKuboHealthy.mockResolvedValue(false);
    waitForKubo.mockResolvedValue(undefined);
    ensureRepoConfigured.mockResolvedValue(undefined);
    const child = mockChildProcess();
    mockManagedNodeSpawn(child);
    const before = process.listeners('exit');

    await startIPFSNode({ repo: '/tmp/meshkit-exit-test-2', port: 15_095, gatewayPort: 18_095 });
    child.emit('exit', 0, null);

    expect(newExitListeners(before)).toHaveLength(0);
  });

  it('does not add an exit hook when attaching to an existing daemon', async () => {
    isKuboHealthy.mockResolvedValue(true);
    const before = process.listeners('exit');

    await startIPFSNode({ port: 5001 });

    expect(newExitListeners(before)).toHaveLength(0);
  });
});

describe('stopIPFSNode', () => {
  it('delegates to handle.stop()', async () => {
    const stop = vi.fn(async () => undefined);
    await stopIPFSNode({
      url: 'http://127.0.0.1:5001',
      managed: true,
      stop,
    });
    expect(stop).toHaveBeenCalledOnce();
  });
});
