export type DriverStatus = 'available' | 'on_trip' | 'offline';

export interface Driver {
  id: string;
  user_id: string;       // Supabase auth user ID
  full_name: string;
  phone: string;
  license_number: string;
  status: DriverStatus;
  vehicle_id: string | null;
  created_at: string;
  updated_at: string;
}
