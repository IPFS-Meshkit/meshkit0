/**
 * Supported PPT network presets shipped with Meshkit.
 * Default for gated access is Arbitrum Sepolia (testnet).
 */
export type MeshkitPptNetwork = 'arbitrumSepolia' | 'arbitrumOne';

/** Storage operations that require a PPT fee when gated access is enabled. */
export type GatedAccessOperation = 'upload' | 'retrieve' | 'pin';

/**
 * App-supplied wallet adapter for gated access.
 * Meshkit never holds private keys — the host app wires MetaMask, WalletConnect, viem, etc.
 */
export interface MeshkitGatedAccessWallet {
  /** Checksummed or hex user address that pays the PPT fee. */
  readonly address: `0x${string}`;

  /** Active chain id of the connected wallet. */
  getChainId(): Promise<number>;

  /** ERC-20 `balanceOf` for the given token (PPT). */
  getTokenBalance(tokenAddress: `0x${string}`): Promise<bigint>;

  /**
   * Transfer `amount` of `tokenAddress` to `to`.
   * @returns transaction hash
   */
  transferToken(params: {
    tokenAddress: `0x${string}`;
    to: `0x${string}`;
    amount: bigint;
  }): Promise<`0x${string}`>;
}

/**
 * Optional pay-per-op PPT gate. Omit from client config for free ungated ops.
 * When set, each upload / retrieve / pin transfers `feeAmount` PPT to `recipientAddress`.
 */
export interface MeshkitGatedAccessConfig {
  /** Developer EOA or contract that receives PPT fees. */
  recipientAddress: `0x${string}`;

  /** Default PPT fee per gated op (token base units). Developer-set. */
  feeAmount: bigint;

  /** Optional per-operation fee overrides. */
  fees?: Partial<Record<GatedAccessOperation, bigint>>;

  /** Network preset. Defaults to `arbitrumSepolia`. */
  network?: MeshkitPptNetwork;

  /** Override preset PPT token address. Required for `arbitrumOne` until mainnet PPT is published. */
  tokenAddress?: `0x${string}`;

  /** Override preset JSON-RPC URL. */
  rpcUrl?: string;

  /** Override preset chain id. */
  chainId?: number;

  /** End-user wallet that pays the fee. */
  wallet: MeshkitGatedAccessWallet;
}

/** Fully resolved gate settings after applying network presets. */
export interface ResolvedGatedAccess {
  recipientAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  chainId: number;
  rpcUrl: string;
  feeAmount: bigint;
  fees?: Partial<Record<GatedAccessOperation, bigint>>;
  wallet: MeshkitGatedAccessWallet;
  network: MeshkitPptNetwork;
}
