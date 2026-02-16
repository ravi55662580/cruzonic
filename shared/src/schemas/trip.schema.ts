import { z } from 'zod';

export const createTripSchema = z.object({
  driver_id: z.string().uuid(),
  vehicle_id: z.string().uuid(),
  origin_address: z.string().min(1),
  destination_address: z.string().min(1),
  notes: z.string().optional(),
});

export const updateTripSchema = z.object({
  status: z.enum(['in_progress', 'completed', 'cancelled']).optional(),
  distance_km: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

export type CreateTripInput = z.infer<typeof createTripSchema>;
export type UpdateTripInput = z.infer<typeof updateTripSchema>;
