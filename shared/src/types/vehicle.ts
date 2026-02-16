export type VehicleStatus = 'active' | 'maintenance' | 'retired';

export interface Vehicle {
  id: string;
  plate_number: string;
  make: string;
  model: string;
  year: number;
  status: VehicleStatus;
  current_driver_id: string | null;
  created_at: string;
  updated_at: string;
}
