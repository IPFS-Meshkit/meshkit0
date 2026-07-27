import { z } from 'zod';

/**
 * Raw Zod shape for the upload tool.
 * Used for MCP tool registration (which expects ZodRawShapeCompat).
 */
export const uploadShape = {
  content: z
    .string()
    .optional()
    .describe('UTF-8 text content to upload'),
  base64: z
    .string()
    .optional()
    .describe('Base64-encoded binary content to upload'),
  password: z
    .string()
    .optional()
    .describe(
      'If provided, content is encrypted with AES-256-GCM (PBKDF2-SHA256 key) ' +
      'before upload. The CID identifies the encrypted blob. ' +
      'Only those who know this password can decrypt the file.',
    ),
  pbkdf2Iterations: z
    .number()
    .int()
    .min(1)
    .max(0xffffffff)
    .optional()
    .describe(
      'PBKDF2 iteration count for key derivation. Defaults to 200,000. ' +
      'Higher values increase brute-force resistance at the cost of speed.',
    ),
};

/**
 * Full schema including runtime refinement (either content or base64 required).
 * Use for type inference (`UploadInput`) and manual validation in handlers.
 */
export const uploadSchema = z
  .object(uploadShape)
  .refine((data) => data.content !== undefined || data.base64 !== undefined, {
    message: 'Either content or base64 is required',
  });

export const retrieveSchema = {
  cid: z.string().describe('IPFS CID to retrieve'),
  password: z
    .string()
    .optional()
    .describe(
      'If the stored content was uploaded with encryption, provide the same ' +
      'password to decrypt it. Omit to receive the raw (encrypted) bytes.',
    ),
};

export const pinSchema = {
  cid: z.string().describe('IPFS CID to pin'),
};

export type UploadInput = z.infer<typeof uploadSchema>;
export type RetrieveInput = z.infer<z.ZodObject<typeof retrieveSchema>>;
export type PinInput = z.infer<z.ZodObject<typeof pinSchema>>;
