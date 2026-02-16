import type { TripStatus } from '../types/trip';
import type { DriverStatus } from '../types/driver';

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const DRIVER_STATUS_LABELS: Record<DriverStatus, string> = {
  available: 'Available',
  on_trip: 'On Trip',
  offline: 'Offline',
};

export function tripStatusLabel(status: TripStatus): string {
  return TRIP_STATUS_LABELS[status] ?? status;
}

export function driverStatusLabel(status: DriverStatus): string {
  return DRIVER_STATUS_LABELS[status] ?? status;
}
