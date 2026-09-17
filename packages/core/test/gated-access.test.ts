import { describe, expect, it, vi } from 'vitest';
import {
  assertGatedAccess,
  GatedAccessError,
  PPT_NETWORKS,
  resolveFee,
  resolveGatedAccess,
} from '../src/gated-access/index.js';
import type {
  MeshkitGatedAccessConfig,
  MeshkitGatedAccessWallet,
} from '../src/gated-access/types.js';

const RECIPIENT = '0x1111111111111111111111111111111111111111' as const;
const USER = '0x2222222222222222222222222222222222222222' as const;
const FEE = 10n ** 18n;

function createMockWallet(
  overrides: Partial<MeshkitGatedAccessWallet> = {},
): MeshkitGatedAccessWallet {
  return {
    address: USER,
    getChainId: async () => 421614,
    getTokenBalance: async () => FEE * 2n,
    transferToken: async () =>
      '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ...overrides,
  };
}

function baseConfig(
  overrides: Partial<MeshkitGatedAccessConfig> = {},
): MeshkitGatedAccessConfig {
  return {
    recipientAddress: RECIPIENT,
    feeAmount: FEE,
    wallet: createMockWallet(),
    ...overrides,
  };
}

describe('resolveGatedAccess', () => {
  it('defaults to arbitrumSepolia PPT token', () => {
    const resolved = resolveGatedAccess(baseConfig());
    expect(resolved.network).toBe('arbitrumSepolia');
    expect(resolved.chainId).toBe(421614);
    expect(resolved.tokenAddress).toBe(
      PPT_NETWORKS.arbitrumSepolia.tokenAddress,
    );
    expect(resolved.rpcUrl).toBe(PPT_NETWORKS.arbitrumSepolia.rpcUrl);
  });

  it('allows tokenAddress override on arbitrumOne', () => {
    const token = '0x3333333333333333333333333333333333333333' as const;
    const resolved = resolveGatedAccess(
      baseConfig({ network: 'arbitrumOne', tokenAddress: token }),
    );
    expect(resolved.network).toBe('arbitrumOne');
    expect(resolved.chainId).toBe(42161);
    expect(resolved.tokenAddress).toBe(token);
  });

  it('throws CONFIG when arbitrumOne has no token', () => {
    expect(() =>
      resolveGatedAccess(baseConfig({ network: 'arbitrumOne' })),
    ).toThrow(GatedAccessError);

    try {
      resolveGatedAccess(baseConfig({ network: 'arbitrumOne' }));
    } catch (err) {
      expect(err).toMatchObject({ name: 'GatedAccessError', code: 'CONFIG' });
    }
  });

  it('resolveFee uses per-op override when present', () => {
    const resolved = resolveGatedAccess(
      baseConfig({
        fees: { retrieve: 5n ** 17n },
      }),
    );
    expect(resolveFee(resolved, 'upload')).toBe(FEE);
    expect(resolveFee(resolved, 'retrieve')).toBe(5n ** 17n);
  });
});

describe('assertGatedAccess', () => {
  it('no-ops when config is undefined', async () => {
    await expect(assertGatedAccess(undefined, 'upload')).resolves.toBeUndefined();
  });

  it('transfers fee before succeeding', async () => {
    const transferToken = vi.fn(async () => '0xbbb' as `0x${string}`);
    const result = await assertGatedAccess(
      baseConfig({ wallet: createMockWallet({ transferToken }) }),
      'upload',
    );

    expect(result?.txHash).toBe('0xbbb');
    expect(result?.feeAmount).toBe(FEE);
    expect(transferToken).toHaveBeenCalledWith({
      tokenAddress: PPT_NETWORKS.arbitrumSepolia.tokenAddress,
      to: RECIPIENT,
      amount: FEE,
    });
  });

  it('throws INSUFFICIENT_BALANCE without transferring', async () => {
    const transferToken = vi.fn();
    await expect(
      assertGatedAccess(
        baseConfig({
          wallet: createMockWallet({
            getTokenBalance: async () => 0n,
            transferToken,
          }),
        }),
        'pin',
      ),
    ).rejects.toMatchObject({
      name: 'GatedAccessError',
      code: 'INSUFFICIENT_BALANCE',
      balance: 0n,
      feeAmount: FEE,
      operation: 'pin',
    });
    expect(transferToken).not.toHaveBeenCalled();
  });

  it('throws WRONG_CHAIN when wallet chain mismatches', async () => {
    await expect(
      assertGatedAccess(
        baseConfig({
          wallet: createMockWallet({ getChainId: async () => 1 }),
        }),
        'retrieve',
      ),
    ).rejects.toMatchObject({
      name: 'GatedAccessError',
      code: 'WRONG_CHAIN',
      chainId: 421614,
    });
  });

  it('throws TRANSFER_FAILED when transfer rejects', async () => {
    await expect(
      assertGatedAccess(
        baseConfig({
          wallet: createMockWallet({
            transferToken: async () => {
              throw new Error('user rejected');
            },
          }),
        }),
        'upload',
      ),
    ).rejects.toMatchObject({
      name: 'GatedAccessError',
      code: 'TRANSFER_FAILED',
    });
  });
});
