export type TripStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface Trip {
  id: string;
  driver_id: string;
  vehicle_id: string;
  status: TripStatus;
  origin_address: string;
  destination_address: string;
  started_at: string | null;
  ended_at: string | null;
  distance_km: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
