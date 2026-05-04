import { z } from "zod";

export const providerTypeSchema = z.string().min(1).max(64);

export const providerSummarySchema = z.object({
  id: z.number().int(),
  type: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ProviderSummary = z.infer<typeof providerSummarySchema>;

export const providerDetailSchema = providerSummarySchema.extend({
  // Sensitive fields are masked when read.
  config: z.record(z.unknown()),
});

export type ProviderDetail = z.infer<typeof providerDetailSchema>;

export const providerCreateRequestSchema = z.object({
  type: providerTypeSchema,
  name: z.string().min(1).max(128),
  config: z.record(z.unknown()),
});

export type ProviderCreateRequest = z.infer<typeof providerCreateRequestSchema>;

export const providerUpdateRequestSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  config: z.record(z.unknown()).optional(),
});

export type ProviderUpdateRequest = z.infer<typeof providerUpdateRequestSchema>;

/**
 * Field metadata used by the FE to auto-render a config form
 * for any provider plugin without hard-coding the layout.
 */
export const providerFieldMetaSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  type: z.enum(["string", "url", "password", "number", "boolean"]),
  required: z.boolean().default(true),
  placeholder: z.string().optional(),
  default: z.unknown().optional(),
  secret: z.boolean().default(false),
});

export type ProviderFieldMeta = z.infer<typeof providerFieldMetaSchema>;

export const providerTypeMetaSchema = z.object({
  type: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
  hostnameHint: z.string().optional(),
  supportsIPv6: z.boolean(),
  fields: z.array(providerFieldMetaSchema),
});

export type ProviderTypeMeta = z.infer<typeof providerTypeMetaSchema>;
