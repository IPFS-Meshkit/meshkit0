/**
 * Integration tests for encrypted upload/retrieve.
 *
 * These tests require a running Kubo daemon (or are skipped via SKIP_INTEGRATION=1).
 * They exercise the full stack: encrypt → upload to IPFS → retrieve → decrypt.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  init,
  isEncryptedPayload,
  MeshkitError,
  resolveRepoPath,
  type IPFSNodeHandle,
} from '@ipfs-meshkit/meshkit';
import { hasKubo, removeDir, stopManagedNode } from './helpers.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const TEST_REPO = join(testDir, '.ipfs-encryption-test');
const TEST_PORT = 15_005;
const TEST_GATEWAY_PORT = 18_005;
const TEST_HOST = '127.0.0.1';

const localNodeOptions = {
  repo: TEST_REPO,
  host: TEST_HOST,
  port: TEST_PORT,
  gatewayPort: TEST_GATEWAY_PORT,
} as const;

const PASSWORD = 'correct-horse-battery-staple-integration';

describe.skipIf(!hasKubo())('encrypted storage integration', () => {
  let localNode: IPFSNodeHandle | undefined;

  beforeAll(async () => {
    await removeDir(resolveRepoPath(TEST_REPO));
  });

  afterAll(async () => {
    await stopManagedNode(localNode);
    await removeDir(resolveRepoPath(TEST_REPO));
  });

  describe.sequential('encrypted upload / retrieve lifecycle', () => {
    // -------------------------------------------------------------------------
    // Phase 1 — encrypt and upload several content types
    // -------------------------------------------------------------------------

    let textCid = '';
    let jsonCid = '';
    let binaryCid = '';
    let emptyCid = '';

    const originalText = 'MSC1234567 — confidential manifest data';
    const originalJson = JSON.stringify({ vessel: 'Ever Given', port: 'Suez', msc: 'MSC9876543' });
    // Simulate PDF magic bytes + some binary payload
    const originalBinary = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, // %PDF-1.4
      ...Array.from({ length: 64 }, (_, i) => i),
    ]);
    const originalEmpty = new Uint8Array(0);

    it('phase 1: start node and upload encrypted content of multiple types', async () => {
      const { meshkit, localNode: node } = await init({
        localNode: localNodeOptions,
      });
      localNode = node;

      const enc = { encrypt: { password: PASSWORD, iterations: 1_000 } };

      textCid   = await meshkit.upload(new TextEncoder().encode(originalText), enc);
      jsonCid   = await meshkit.upload(new TextEncoder().encode(originalJson), enc);
      binaryCid = await meshkit.upload(originalBinary, enc);
      emptyCid  = await meshkit.upload(originalEmpty, enc);

      expect(textCid).toBeTruthy();
      expect(jsonCid).toBeTruthy();
      expect(binaryCid).toBeTruthy();
      expect(emptyCid).toBeTruthy();

      // All four CIDs must be distinct (different random salts per upload)
      const cids = [textCid, jsonCid, binaryCid, emptyCid];
      expect(new Set(cids).size).toBe(4);
    });

    // -------------------------------------------------------------------------
    // Phase 2 — retrieve raw bytes (no password) must be encrypted
    // -------------------------------------------------------------------------

    it('phase 2: retrieve without password returns encrypted blob (EMSH magic)', async () => {
      const { meshkit } = await init({
        localNode: false,
        nodes: [`http://${TEST_HOST}:${TEST_PORT}`],
      });

      const rawText   = await meshkit.retrieve(textCid);
      const rawJson   = await meshkit.retrieve(jsonCid);
      const rawBinary = await meshkit.retrieve(binaryCid);
      const rawEmpty  = await meshkit.retrieve(emptyCid);

      expect(isEncryptedPayload(rawText)).toBe(true);
      expect(isEncryptedPayload(rawJson)).toBe(true);
      expect(isEncryptedPayload(rawBinary)).toBe(true);
      expect(isEncryptedPayload(rawEmpty)).toBe(true);

      // Must NOT match the original plaintext
      expect(rawText).not.toEqual(new TextEncoder().encode(originalText));
      expect(rawJson).not.toEqual(new TextEncoder().encode(originalJson));
    });

    // -------------------------------------------------------------------------
    // Phase 3 — retrieve with correct password decrypts transparently
    // -------------------------------------------------------------------------

    it('phase 3: retrieve with correct password decrypts to original content', async () => {
      const { meshkit } = await init({
        localNode: false,
        nodes: [`http://${TEST_HOST}:${TEST_PORT}`],
      });

      const opts = { password: PASSWORD };

      const text   = await meshkit.retrieve(textCid, opts);
      const json   = await meshkit.retrieve(jsonCid, opts);
      const binary = await meshkit.retrieve(binaryCid, opts);
      const empty  = await meshkit.retrieve(emptyCid, opts);

      expect(new TextDecoder().decode(text)).toBe(originalText);
      expect(new TextDecoder().decode(json)).toBe(originalJson);
      expect(binary).toEqual(originalBinary);
      expect(empty).toEqual(originalEmpty);
    });

    // -------------------------------------------------------------------------
    // Phase 4 — wrong password throws
    // -------------------------------------------------------------------------

    it('phase 4: retrieve with wrong password throws MeshkitError', async () => {
      const { meshkit } = await init({
        localNode: false,
        nodes: [`http://${TEST_HOST}:${TEST_PORT}`],
      });

      await expect(
        meshkit.retrieve(textCid, { password: 'wrong-password-definitely' }),
      ).rejects.toBeInstanceOf(MeshkitError);
    });

    // -------------------------------------------------------------------------
    // Phase 5 — same plaintext + same password → different CIDs each upload
    // -------------------------------------------------------------------------

    it('phase 5: uploading the same plaintext twice yields different CIDs', async () => {
      const { meshkit } = await init({
        localNode: false,
        nodes: [`http://${TEST_HOST}:${TEST_PORT}`],
      });

      const data = new TextEncoder().encode('repeated confidential data');
      const enc = { encrypt: { password: PASSWORD, iterations: 1_000 } };

      const cid1 = await meshkit.upload(data, enc);
      const cid2 = await meshkit.upload(data, enc);

      // Random salt makes the CID different every time
      expect(cid1).not.toBe(cid2);

      // But both decrypt correctly
      const r1 = await meshkit.retrieve(cid1, { password: PASSWORD });
      const r2 = await meshkit.retrieve(cid2, { password: PASSWORD });
      expect(r1).toEqual(data);
      expect(r2).toEqual(data);
    });

    // -------------------------------------------------------------------------
    // Phase 6 — unencrypted content is unaffected (regression guard)
    // -------------------------------------------------------------------------

    it('phase 6: upload without encryption and retrieve without password works', async () => {
      const { meshkit } = await init({
        localNode: false,
        nodes: [`http://${TEST_HOST}:${TEST_PORT}`],
      });

      const plaintext = new TextEncoder().encode('completely public data');
      const cid = await meshkit.upload(plaintext);

      const retrieved = await meshkit.retrieve(cid);
      expect(retrieved).toEqual(plaintext);
      expect(isEncryptedPayload(retrieved)).toBe(false);
    });

    // -------------------------------------------------------------------------
    // Phase 7 — graceful shutdown
    // -------------------------------------------------------------------------

    it('phase 7: stop the local node', async () => {
      await stopManagedNode(localNode);
      localNode = undefined;
    });
  });
});
