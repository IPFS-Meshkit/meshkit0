import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ITERATIONS,
  decrypt,
  encrypt,
  isEncryptedPayload,
} from '../src/crypto.js';
import { MeshkitError } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PASSWORD = 'correct-horse-battery-staple';
const PLAINTEXT = new TextEncoder().encode('Hello, IPFS-Meshkit encryption!');
const EMPTY = new Uint8Array(0);

/** Encrypt with default options and low iterations so tests run fast. */
function fastEncrypt(data: Uint8Array, password = PASSWORD) {
  return encrypt(data, { password, iterations: 1 });
}

// ---------------------------------------------------------------------------
// isEncryptedPayload
// ---------------------------------------------------------------------------

describe('isEncryptedPayload', () => {
  it('returns false for an empty buffer', () => {
    expect(isEncryptedPayload(new Uint8Array(0))).toBe(false);
  });

  it('returns false for a short buffer (< 53 bytes)', () => {
    expect(isEncryptedPayload(new Uint8Array(52))).toBe(false);
  });

  it('returns false for a buffer with wrong magic bytes', () => {
    const buf = new Uint8Array(60);
    buf[0] = 0xde; buf[1] = 0xad; buf[2] = 0xbe; buf[3] = 0xef;
    buf[4] = 0x01;
    expect(isEncryptedPayload(buf)).toBe(false);
  });

  it('returns false for a buffer with correct magic but wrong version byte', () => {
    const buf = new Uint8Array(60);
    // EMSH magic
    buf[0] = 0x45; buf[1] = 0x4d; buf[2] = 0x53; buf[3] = 0x48;
    buf[4] = 0x02; // wrong version
    expect(isEncryptedPayload(buf)).toBe(false);
  });

  it('returns false for arbitrary text content', () => {
    const text = new TextEncoder().encode('{"ipfs":"content","key":"value"}');
    expect(isEncryptedPayload(text)).toBe(false);
  });

  it('returns true for a buffer produced by encrypt()', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    expect(isEncryptedPayload(payload)).toBe(true);
  });

  it('returns true when passed a subarray (non-zero byteOffset) of an encrypted payload', async () => {
    const wrapper = new Uint8Array(100);
    const payload = await fastEncrypt(PLAINTEXT);
    // Place encrypted payload at offset 10 inside wrapper
    wrapper.set(payload, 10);
    expect(isEncryptedPayload(wrapper.subarray(10))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// encrypt
// ---------------------------------------------------------------------------

describe('encrypt', () => {
  it('returns a Uint8Array longer than the plaintext', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    // overhead = 37 (header) + 16 (GCM tag) = 53 bytes
    expect(payload).toBeInstanceOf(Uint8Array);
    expect(payload.length).toBe(PLAINTEXT.length + 53);
  });

  it('always produces a valid EMSH payload', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    expect(isEncryptedPayload(payload)).toBe(true);
  });

  it('produces different ciphertexts for the same plaintext + password (random salt/nonce)', async () => {
    const a = await fastEncrypt(PLAINTEXT);
    const b = await fastEncrypt(PLAINTEXT);
    // Payloads must differ (probability of collision is astronomically low)
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });

  it('produces different ciphertexts for different plaintexts', async () => {
    const a = await fastEncrypt(new TextEncoder().encode('file-a'));
    const b = await fastEncrypt(new TextEncoder().encode('file-b'));
    expect(Buffer.from(a).toString('hex')).not.toBe(Buffer.from(b).toString('hex'));
  });

  it('handles an empty plaintext (Uint8Array of length 0)', async () => {
    const payload = await fastEncrypt(EMPTY);
    expect(payload).toBeInstanceOf(Uint8Array);
    // header(37) + tag(16) = 53 bytes
    expect(payload.length).toBe(53);
    expect(isEncryptedPayload(payload)).toBe(true);
  });

  it('handles a large payload (1 MB)', async () => {
    const large = new Uint8Array(1024 * 1024);
    // getRandomValues is limited to 65_536 bytes per call — fill in chunks
    for (let offset = 0; offset < large.length; offset += 65_536) {
      globalThis.crypto.getRandomValues(large.subarray(offset, offset + 65_536));
    }
    const payload = await fastEncrypt(large);
    expect(payload.length).toBe(large.length + 53);
    expect(isEncryptedPayload(payload)).toBe(true);
  });

  it('stores a custom iterations value in the wire format', async () => {
    const CUSTOM_ITER = 12_345;
    const payload = await encrypt(PLAINTEXT, { password: PASSWORD, iterations: CUSTOM_ITER });
    // Iterations field is at bytes [5..8] as uint32 big-endian
    const view = new DataView(payload.buffer);
    expect(view.getUint32(5, false)).toBe(CUSTOM_ITER);
  });

  it('stores the default iterations (200_000) when none is provided', async () => {
    const payload = await encrypt(PLAINTEXT, { password: PASSWORD });
    const view = new DataView(payload.buffer);
    expect(view.getUint32(5, false)).toBe(DEFAULT_ITERATIONS);
  });

  it('throws MeshkitError for an empty password', async () => {
    await expect(encrypt(PLAINTEXT, { password: '' })).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError for iterations = 0', async () => {
    await expect(
      encrypt(PLAINTEXT, { password: PASSWORD, iterations: 0 }),
    ).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError for non-integer iterations', async () => {
    await expect(
      encrypt(PLAINTEXT, { password: PASSWORD, iterations: 1.5 }),
    ).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError for iterations > uint32 max', async () => {
    await expect(
      encrypt(PLAINTEXT, { password: PASSWORD, iterations: 0x1_0000_0000 }),
    ).rejects.toBeInstanceOf(MeshkitError);
  });
});

// ---------------------------------------------------------------------------
// decrypt
// ---------------------------------------------------------------------------

describe('decrypt', () => {
  it('round-trips plaintext through encrypt → decrypt', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    const recovered = await decrypt(payload, PASSWORD);
    expect(recovered).toEqual(PLAINTEXT);
  });

  it('round-trips an empty plaintext', async () => {
    const payload = await fastEncrypt(EMPTY);
    const recovered = await decrypt(payload, PASSWORD);
    expect(recovered).toEqual(EMPTY);
  });

  it('round-trips a 1 MB payload', async () => {
    const large = new Uint8Array(1024 * 1024);
    // getRandomValues is limited to 65_536 bytes per call — fill in chunks
    for (let offset = 0; offset < large.length; offset += 65_536) {
      globalThis.crypto.getRandomValues(large.subarray(offset, offset + 65_536));
    }
    const payload = await fastEncrypt(large);
    const recovered = await decrypt(payload, PASSWORD);
    expect(recovered).toEqual(large);
  });

  it('round-trips binary data (simulated PDF magic bytes)', async () => {
    // %PDF-1.4 header
    const pdfLike = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    const payload = await fastEncrypt(pdfLike);
    const recovered = await decrypt(payload, PASSWORD);
    expect(recovered).toEqual(pdfLike);
  });

  it('round-trips JSON content', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ mscCode: 'MSC1234567', vessel: 'Ever Given' }));
    const payload = await fastEncrypt(json);
    const recovered = await decrypt(payload, PASSWORD);
    expect(new TextDecoder().decode(recovered)).toBe(JSON.stringify({ mscCode: 'MSC1234567', vessel: 'Ever Given' }));
  });

  it('reads the correct iterations from the wire format (self-describing)', async () => {
    // Encrypt with custom iterations, then decrypt without knowing iterations up-front.
    // The decoder should read iterations from the payload header.
    const CUSTOM_ITER = 5_000;
    const payload = await encrypt(PLAINTEXT, { password: PASSWORD, iterations: CUSTOM_ITER });
    const recovered = await decrypt(payload, PASSWORD);
    expect(recovered).toEqual(PLAINTEXT);
  });

  it('works correctly when passed a subarray with non-zero byteOffset', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    // Prepend 8 bytes of garbage to test byteOffset handling
    const wrapped = new Uint8Array(8 + payload.length);
    wrapped.set(payload, 8);
    const recovered = await decrypt(wrapped.subarray(8), PASSWORD);
    expect(recovered).toEqual(PLAINTEXT);
  });

  it('throws MeshkitError on wrong password', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    await expect(decrypt(payload, 'wrong-password')).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError with a generic message (no oracle)', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    const err = await decrypt(payload, 'wrong-password').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MeshkitError);
    // Must not say "wrong password" in isolation — that helps offline attackers
    expect((err as MeshkitError).message).toContain('Decryption failed');
  });

  it('throws MeshkitError for raw (non-encrypted) bytes', async () => {
    await expect(decrypt(PLAINTEXT, PASSWORD)).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError for a truncated payload (missing GCM tag)', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    // Slice off the last 20 bytes to break the GCM tag
    const truncated = payload.slice(0, payload.length - 20);
    await expect(decrypt(truncated, PASSWORD)).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError for a payload with a single bit flipped in the ciphertext', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    const tampered = new Uint8Array(payload);
    // Flip a bit in the ciphertext section (after the 37-byte header)
    tampered[40] ^= 0x01;
    await expect(decrypt(tampered, PASSWORD)).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError when salt is corrupted', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    const tampered = new Uint8Array(payload);
    tampered[9] ^= 0xff; // salt starts at byte 9
    await expect(decrypt(tampered, PASSWORD)).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError when nonce is corrupted', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    const tampered = new Uint8Array(payload);
    tampered[25] ^= 0xff; // nonce starts at byte 25
    await expect(decrypt(tampered, PASSWORD)).rejects.toBeInstanceOf(MeshkitError);
  });

  it('throws MeshkitError for an empty password', async () => {
    const payload = await fastEncrypt(PLAINTEXT);
    await expect(decrypt(payload, '')).rejects.toBeInstanceOf(MeshkitError);
  });

  it('two encrypts of the same plaintext both decrypt correctly (independent random state)', async () => {
    const [p1, p2] = await Promise.all([fastEncrypt(PLAINTEXT), fastEncrypt(PLAINTEXT)]);
    const [r1, r2] = await Promise.all([decrypt(p1, PASSWORD), decrypt(p2, PASSWORD)]);
    expect(r1).toEqual(PLAINTEXT);
    expect(r2).toEqual(PLAINTEXT);
  });

  it('decrypting p1 with password of p2 fails gracefully', async () => {
    const p1 = await encrypt(PLAINTEXT, { password: 'password-one', iterations: 1 });
    await expect(decrypt(p1, 'password-two')).rejects.toBeInstanceOf(MeshkitError);
  });
});
