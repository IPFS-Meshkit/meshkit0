import type { MeshkitPptNetwork } from './types.js';

export interface PptNetworkPreset {
  chainId: number;
  /** PPT ERC-20 address; undefined until the network has a published token. */
  tokenAddress: `0x${string}` | undefined;
  rpcUrl: string;
}

/**
 * Canonical PPT network presets.
 * Arbitrum Sepolia ships with the live testnet PPT contract.
 * Arbitrum One token is filled when mainnet PPT is deployed (or overridden via config).
 */
export const PPT_NETWORKS: Record<MeshkitPptNetwork, PptNetworkPreset> = {
  arbitrumSepolia: {
    chainId: 421614,
    tokenAddress: '0x38c505EE3FDf02C0A041B08611aDB2F1d92DF410',
    rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
  },
  arbitrumOne: {
    chainId: 42161,
    tokenAddress: undefined,
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
  },
};

export const DEFAULT_PPT_NETWORK: MeshkitPptNetwork = 'arbitrumSepolia';
