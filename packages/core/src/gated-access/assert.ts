import { GatedAccessError } from './errors.js';
import { resolveFee, resolveGatedAccess } from './resolve.js';
import type {
  GatedAccessOperation,
  MeshkitGatedAccessConfig,
  ResolvedGatedAccess,
} from './types.js';

export interface AssertGatedAccessResult {
  /** Transaction hash of the PPT fee transfer. */
  txHash: `0x${string}`;
  feeAmount: bigint;
  resolved: ResolvedGatedAccess;
}

/**
 * Collect the PPT fee for a gated operation, or no-op when `config` is omitted.
 * Must run before any Kubo / IPFS IO.
 */
export async function assertGatedAccess(
  config: MeshkitGatedAccessConfig | undefined,
  operation: GatedAccessOperation,
): Promise<AssertGatedAccessResult | undefined> {
  if (config === undefined) {
    return undefined;
  }

  const resolved = resolveGatedAccess(config);
  const feeAmount = resolveFee(resolved, operation);
  const { wallet, tokenAddress, recipientAddress, chainId } = resolved;

  let walletChainId: number;
  try {
    walletChainId = await wallet.getChainId();
  } catch (cause) {
    throw new GatedAccessError('Failed to read wallet chain id', {
      code: 'WRONG_CHAIN',
      feeAmount,
      recipientAddress,
      tokenAddress,
      chainId,
      operation,
      cause,
    });
  }

  if (walletChainId !== chainId) {
    throw new GatedAccessError(
      `Wallet is on chain ${walletChainId}; gated access requires chain ${chainId}`,
      {
        code: 'WRONG_CHAIN',
        feeAmount,
        recipientAddress,
        tokenAddress,
        chainId,
        operation,
      },
    );
  }

  let balance: bigint;
  try {
    balance = await wallet.getTokenBalance(tokenAddress);
  } catch (cause) {
    throw new GatedAccessError('Failed to read PPT balance', {
      code: 'TRANSFER_FAILED',
      feeAmount,
      recipientAddress,
      tokenAddress,
      chainId,
      operation,
      cause,
    });
  }

  if (balance < feeAmount) {
    throw new GatedAccessError(
      `Insufficient PPT: have ${balance.toString()}, need ${feeAmount.toString()} for ${operation}`,
      {
        code: 'INSUFFICIENT_BALANCE',
        feeAmount,
        balance,
        recipientAddress,
        tokenAddress,
        chainId,
        operation,
      },
    );
  }

  let txHash: `0x${string}`;
  try {
    txHash = await wallet.transferToken({
      tokenAddress,
      to: recipientAddress,
      amount: feeAmount,
    });
  } catch (cause) {
    throw new GatedAccessError(
      `PPT transfer failed for ${operation}`,
      {
        code: 'TRANSFER_FAILED',
        feeAmount,
        balance,
        recipientAddress,
        tokenAddress,
        chainId,
        operation,
        cause,
      },
    );
  }

  return { txHash, feeAmount, resolved };
}
