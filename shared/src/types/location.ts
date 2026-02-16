export interface LocationEvent {
  id: string;
  trip_id: string;
  driver_id: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  heading: number | null;        // degrees 0–360
  accuracy_m: number | null;
  recorded_at: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}
