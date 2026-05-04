import { z } from "zod";

export const loginRequestSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  user: z.object({
    id: z.number().int(),
    username: z.string(),
  }),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const changePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(256),
  })
  .strict();

export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const initialSetupRequestSchema = z
  .object({
    username: z.string().min(3).max(64),
    password: z.string().min(8).max(256),
  })
  .strict();

export type InitialSetupRequest = z.infer<typeof initialSetupRequestSchema>;

export const setupStatusResponseSchema = z.object({
  needsSetup: z.boolean(),
});

export type SetupStatusResponse = z.infer<typeof setupStatusResponseSchema>;
