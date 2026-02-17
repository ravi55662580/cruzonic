/**
 * Authentication DTOs
 *
 * Request/response types and Zod schemas for authentication endpoints.
 */

import { z } from 'zod';

/**
 * Login Request Schema
 */
export const LoginRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * Login Response
 */
export interface LoginResponse {
  user: {
    id: string;
    email: string;
    role: string;
    full_name: string;
    carrier_id: string;
  };
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

/**
 * Signup Request Schema
 */
export const SignupRequestSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  full_name: z.string().min(2, 'Full name must be at least 2 characters'),
  phone: z.string().optional(),
  role: z.enum(['driver', 'fleet_manager', 'admin'], {
    errorMap: () => ({ message: 'Role must be driver, fleet_manager, or admin' }),
  }),
  carrier_id: z.string().uuid('Invalid carrier ID format'),
  // Driver-specific fields (required if role is 'driver')
  driver_details: z
    .object({
      license_number: z.string().min(1, 'License number is required'),
      license_state: z.string().length(2, 'License state must be 2 characters'),
      license_class: z.string().min(1, 'License class is required'),
      license_expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
      home_terminal_timezone: z.string().min(1, 'Home terminal timezone is required'),
    })
    .optional(),
});

export type SignupRequest = z.infer<typeof SignupRequestSchema>;

/**
 * Signup Response
 */
export interface SignupResponse {
  user: {
    id: string;
    email: string;
    role: string;
    full_name: string;
  };
  message: string;
}

/**
 * Refresh Token Request Schema
 */
export const RefreshTokenRequestSchema = z.object({
  refresh_token: z.string().min(1, 'Refresh token is required'),
});

export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

/**
 * Refresh Token Response
 */
export interface RefreshTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds
}

/**
 * Logout Response
 */
export interface LogoutResponse {
  message: string;
}

/**
 * Change Password Request Schema
 */
export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

/**
 * Change Password Response
 */
export interface ChangePasswordResponse {
  message: string;
}

/**
 * Get Profile Response
 */
export interface ProfileResponse {
  id: string;
  carrier_id: string;
  role: string;
  full_name: string;
  phone?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  driver_details?: Record<string, unknown>;
}
