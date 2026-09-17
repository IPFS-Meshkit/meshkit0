import { GatedAccessError } from './errors.js';
import { DEFAULT_PPT_NETWORK, PPT_NETWORKS } from './networks.js';
import type {
  MeshkitGatedAccessConfig,
  ResolvedGatedAccess,
} from './types.js';

/**
 * Merge explicit config overrides with the selected PPT network preset.
 * Throws {@link GatedAccessError} with code `CONFIG` if no PPT token address is available.
 */
export function resolveGatedAccess(
  config: MeshkitGatedAccessConfig,
): ResolvedGatedAccess {
  const network = config.network ?? DEFAULT_PPT_NETWORK;
  const preset = PPT_NETWORKS[network];

  const tokenAddress = config.tokenAddress ?? preset.tokenAddress;
  const chainId = config.chainId ?? preset.chainId;
  const rpcUrl = config.rpcUrl ?? preset.rpcUrl;

  if (!tokenAddress) {
    throw new GatedAccessError(
      `No PPT token address for network "${network}". Pass tokenAddress or use arbitrumSepolia.`,
      {
        code: 'CONFIG',
        feeAmount: config.feeAmount,
        recipientAddress: config.recipientAddress,
        tokenAddress: '0x0000000000000000000000000000000000000000',
        chainId,
      },
    );
  }

  return {
    recipientAddress: config.recipientAddress,
    tokenAddress,
    chainId,
    rpcUrl,
    feeAmount: config.feeAmount,
    fees: config.fees,
    wallet: config.wallet,
    network,
  };
}

export function resolveFee(
  resolved: ResolvedGatedAccess,
  operation: keyof NonNullable<ResolvedGatedAccess['fees']>,
): bigint {
  return resolved.fees?.[operation] ?? resolved.feeAmount;
}
