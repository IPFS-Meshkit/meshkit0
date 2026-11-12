export type {
  GatedAccessOperation,
  MeshkitGatedAccessConfig,
  MeshkitGatedAccessWallet,
  MeshkitPptNetwork,
  ResolvedGatedAccess,
} from './types.js';

export {
  DEFAULT_PPT_NETWORK,
  PPT_NETWORKS,
  type PptNetworkPreset,
} from './networks.js';

export { GatedAccessError, type GatedAccessErrorCode, type GatedAccessErrorDetails } from './errors.js';

export { resolveFee, resolveGatedAccess } from './resolve.js';

export { assertGatedAccess, type AssertGatedAccessResult } from './assert.js';
