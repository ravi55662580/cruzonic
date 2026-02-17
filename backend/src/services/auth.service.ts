/**
 * Authentication Service
 *
 * Wraps Supabase Auth with application-specific business logic.
 */

import { supabase } from '../config/supabase';
import { DatabaseError, AuthenticationError, ValidationError } from '../models/errors/api-error';
import { logger } from '../utils/logger';
import type {
  LoginResponse,
  SignupResponse,
  RefreshTokenResponse,
  LogoutResponse,
  ChangePasswordResponse,
  ProfileResponse,
} from '../models/dtos/auth.dto';

export class AuthService {
  /**
   * Login user with email and password
   */
  async login(email: string, password: string): Promise<LoginResponse> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      logger.warn('Login failed', { email, error: error.message });
      throw new AuthenticationError('Invalid email or password');
    }

    if (!data.session) {
      logger.warn('Login failed - no session created', { email });
      throw new AuthenticationError('Failed to create session');
    }

    // Fetch profile data
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, carrier_id, full_name, phone, is_active')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      logger.error('Failed to fetch user profile', { userId: data.user.id, error: profileError });
      throw new DatabaseError('Failed to fetch user profile');
    }

    if (!profile.is_active) {
      logger.warn('Login attempt for inactive account', { userId: data.user.id });
      throw new AuthenticationError('Account is inactive');
    }

    logger.info('User logged in', { userId: data.user.id, role: profile.role });

    return {
      user: {
        id: data.user.id,
        email: data.user.email!,
        role: profile.role,
        full_name: profile.full_name,
        carrier_id: profile.carrier_id,
      },
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in || 3600,
    };
  }

  /**
   * Sign up new user
   */
  async signup(params: {
    email: string;
    password: string;
    full_name: string;
    phone?: string;
    role: string;
    carrier_id: string;
    driver_details?: {
      license_number: string;
      license_state: string;
      license_class: string;
      license_expiry: string;
      home_terminal_timezone: string;
    };
  }): Promise<SignupResponse> {
    // Create user via Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email: params.email,
      password: params.password,
      options: {
        data: {
          full_name: params.full_name,
          phone: params.phone,
          role: params.role,
          carrier_id: params.carrier_id,
        },
      },
    });

    if (error) {
      logger.error('Signup failed', { email: params.email, error: error.message });
      throw new ValidationError(error.message);
    }

    if (!data.user) {
      logger.error('Signup failed - no user created', { email: params.email });
      throw new ValidationError('Failed to create user account');
    }

    // Profile is auto-created by database trigger handle_new_user()

    // If role is driver, create driver record
    if (params.role === 'driver' && params.driver_details) {
      const { error: driverError } = await supabase.from('drivers').insert({
        id: crypto.randomUUID(),
        user_id: data.user.id,
        carrier_id: params.carrier_id,
        full_name: params.full_name,
        email: params.email,
        phone: params.phone || '',
        license_number: params.driver_details.license_number,
        license_state: params.driver_details.license_state,
        license_class: params.driver_details.license_class,
        license_expiry: params.driver_details.license_expiry,
        home_terminal_timezone: params.driver_details.home_terminal_timezone,
        status: 'offline',
      });

      if (driverError) {
        logger.error('Failed to create driver record', { userId: data.user.id, error: driverError });
        // Don't fail the signup, but log the error
      }
    }

    logger.info('User signed up', { userId: data.user.id, role: params.role });

    return {
      user: {
        id: data.user.id,
        email: data.user.email!,
        role: params.role,
        full_name: params.full_name,
      },
      message: 'Account created successfully. Please check your email for verification.',
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse> {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session) {
      logger.warn('Token refresh failed', { error: error?.message });
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    logger.debug('Token refreshed successfully');

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in || 3600,
    };
  }

  /**
   * Logout user (revoke tokens)
   */
  async logout(): Promise<LogoutResponse> {
    const { error } = await supabase.auth.signOut();

    if (error) {
      logger.error('Logout failed', { error: error.message });
      throw new DatabaseError('Failed to logout');
    }

    logger.info('User logged out');

    return { message: 'Logged out successfully' };
  }

  /**
   * Change password
   */
  async changePassword(userId: string, newPassword: string): Promise<ChangePasswordResponse> {
    // Verify current user
    const { data: user } = await supabase.auth.getUser();

    if (!user || user.user?.id !== userId) {
      logger.warn('Password change attempt for mismatched user', { userId });
      throw new AuthenticationError('Unauthorized');
    }

    // Update password
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      logger.error('Password change failed', { userId, error: error.message });
      throw new ValidationError('Failed to change password');
    }

    logger.info('Password changed', { userId });

    return { message: 'Password changed successfully' };
  }

  /**
   * Get user profile
   */
  async getProfile(userId: string): Promise<ProfileResponse> {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      logger.error('Failed to fetch profile', { userId, error });
      throw new DatabaseError('Profile not found');
    }

    // If driver, fetch driver details
    if (profile.role === 'driver') {
      const { data: driver } = await supabase
        .from('drivers')
        .select('*')
        .eq('user_id', userId)
        .single();

      return {
        ...profile,
        driver_details: driver || undefined,
      };
    }

    return profile;
  }
}
