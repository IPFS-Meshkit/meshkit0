import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { MeshkitContext } from '../context.js';
import {
  decodeUploadInput,
  encodeRetrievedBytesSafe,
  textResult,
  type UploadInput as RawUploadInput,
} from '../format.js';
import {
  listPinsShape,
  pinSchema,
  retrieveSchema,
  uploadShape,
  type ListPinsInput,
  type PinInput,
  type RetrieveInput,
  type UploadInput,
} from '../schemas/storage.js';
import { runTool, runToolNoInput } from './run-tool.js';

export async function handleUpload(
  ctx: MeshkitContext,
  input: UploadInput,
): Promise<ReturnType<typeof textResult>> {
  const bytes = decodeUploadInput(input as RawUploadInput);

  const uploadOptions = input.password
    ? {
        encrypt: {
          password: input.password,
          ...(input.pbkdf2Iterations !== undefined
            ? { iterations: input.pbkdf2Iterations }
            : {}),
        },
      }
    : undefined;

  const cid = await ctx.meshkit.upload(bytes, uploadOptions);
  return textResult({
    cid,
    encrypted: uploadOptions !== undefined,
  });
}

export async function handleRetrieve(
  ctx: MeshkitContext,
  input: RetrieveInput,
): Promise<ReturnType<typeof textResult>> {
  const retrieveOptions = input.password
    ? { password: input.password }
    : undefined;

  const bytes = await ctx.meshkit.retrieve(input.cid, retrieveOptions);
  const encoded = encodeRetrievedBytesSafe(bytes);
  return textResult({ cid: input.cid, ...encoded });
}

export async function handlePin(
  ctx: MeshkitContext,
  input: PinInput,
): Promise<ReturnType<typeof textResult>> {
  await ctx.meshkit.pin(input.cid);
  return textResult({ pinned: true, cid: input.cid });
}

export async function handleListPins(
  ctx: MeshkitContext,
  input: ListPinsInput = {},
): Promise<ReturnType<typeof textResult>> {
  const pins = await ctx.meshkit.listPins({
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
  });
  return textResult({
    count: pins.length,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
    ...(input.offset !== undefined ? { offset: input.offset } : {}),
    pins,
  });
}

export async function handlePinCount(
  ctx: MeshkitContext,
): Promise<ReturnType<typeof textResult>> {
  const counts = await ctx.meshkit.countPins();
  return textResult(counts);
}

export function registerStorageTools(
  server: McpServer,
  ctx: MeshkitContext,
): void {
  server.tool(
    'ipfs_upload',
    'Upload content to IPFS and return the CID. Optionally encrypt with AES-256-GCM.',
    uploadShape,
    async (input) => runTool(ctx, handleUpload, input),
  );

  server.tool(
    'ipfs_retrieve',
    'Retrieve content from IPFS by CID',
    retrieveSchema,
    async (input) => runTool(ctx, handleRetrieve, input),
  );

  server.tool(
    'ipfs_pin',
    'Pin a CID on the connected IPFS node',
    pinSchema,
    async (input) => runTool(ctx, handlePin, input),
  );

  server.tool(
    'ipfs_list_pins',
    'List pinned CIDs on the primary node. Use limit/offset to page through ' +
      'large pinsets — prefer ipfs_pin_count when you only need the number of pins.',
    listPinsShape,
    async (input: ListPinsInput) => runTool(ctx, handleListPins, input),
  );

  server.tool(
    'ipfs_pin_count',
    'Count pins by type (direct, recursive, indirect, total) on the primary ' +
      'node. Streams the pinset and returns only counts — safe for nodes ' +
      'with millions of pins.',
    async () => runToolNoInput(ctx, handlePinCount),
  );
}
