import type { GatedAccessOperation } from './types.js';

export type GatedAccessErrorCode =
  | 'WRONG_CHAIN'
  | 'INSUFFICIENT_BALANCE'
  | 'TRANSFER_FAILED'
  | 'CONFIG';

export interface GatedAccessErrorDetails {
  code: GatedAccessErrorCode;
  feeAmount: bigint;
  balance?: bigint;
  recipientAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  chainId: number;
  operation?: GatedAccessOperation;
  cause?: unknown;
}

/**
 * Thrown when a gated IPFS operation cannot collect the PPT fee.
 * Apps can surface fee / balance / recipient without Meshkit linking to a DEX.
 */
export class GatedAccessError extends Error {
  readonly code: GatedAccessErrorCode;
  readonly feeAmount: bigint;
  readonly balance?: bigint;
  readonly recipientAddress: `0x${string}`;
  readonly tokenAddress: `0x${string}`;
  readonly chainId: number;
  readonly operation?: GatedAccessOperation;
  readonly cause?: unknown;

  constructor(message: string, details: GatedAccessErrorDetails) {
    super(message);
    this.name = 'GatedAccessError';
    this.code = details.code;
    this.feeAmount = details.feeAmount;
    this.balance = details.balance;
    this.recipientAddress = details.recipientAddress;
    this.tokenAddress = details.tokenAddress;
    this.chainId = details.chainId;
    this.operation = details.operation;
    this.cause = details.cause;
  }
}
