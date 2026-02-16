import { z } from 'zod';

export const createDriverSchema = z.object({
  full_name: z.string().min(2),
  phone: z.string().min(7),
  license_number: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

export const updateDriverSchema = z.object({
  full_name: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  license_number: z.string().min(1).optional(),
  status: z.enum(['available', 'on_trip', 'offline']).optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
});

export type CreateDriverInput = z.infer<typeof createDriverSchema>;
export type UpdateDriverInput = z.infer<typeof updateDriverSchema>;
