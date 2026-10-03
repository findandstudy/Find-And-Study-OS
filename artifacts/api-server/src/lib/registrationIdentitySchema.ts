import { z } from "zod";

export const registrationIdentitySchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  password: z.string().min(1).max(256),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().nullable(),
}).passthrough();

export type RegistrationIdentity = z.infer<typeof registrationIdentitySchema>;
