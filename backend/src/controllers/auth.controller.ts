/**
 * Authentication Controller
 *
 * Handles authentication endpoints: login, signup, refresh, logout, etc.
 */

import type { Request, Response } from 'express';
import { BaseController } from './base.controller';
import type { AuthenticatedRequest } from '../middleware/auth';
import { AuthService } from '../services/auth.service';
import { logger } from '../utils/logger';

export class AuthController extends BaseController {
  private authService: AuthService;

  constructor() {
    super();
    this.authService = new AuthService();
  }

  /**
   * POST /api/v1/auth/login
   * User login with email and password
   */
  async login(req: Request, res: Response): Promise<Response> {
    const { email, password } = req.body;

    logger.info('Login attempt', { email });

    const result = await this.authService.login(email, password);

    return this.success(res, result);
  }

  /**
   * POST /api/v1/auth/signup
   * User signup with profile creation
   */
  async signup(req: Request, res: Response): Promise<Response> {
    const signupData = req.body;

    logger.info('Signup attempt', { email: signupData.email, role: signupData.role });

    const result = await this.authService.signup(signupData);

    return this.created(res, result);
  }

  /**
   * POST /api/v1/auth/refresh
   * Refresh access token using refresh token
   */
  async refresh(req: Request, res: Response): Promise<Response> {
    const { refresh_token } = req.body;

    logger.debug('Token refresh requested');

    const result = await this.authService.refreshToken(refresh_token);

    return this.success(res, result);
  }

  /**
   * POST /api/v1/auth/logout
   * Logout user and revoke tokens
   */
  async logout(req: AuthenticatedRequest, res: Response): Promise<Response> {
    logger.info('Logout requested', { userId: req.user?.id });

    await this.authService.logout();

    return this.success(res, { message: 'Logged out successfully' });
  }

  /**
   * POST /api/v1/auth/change-password
   * Change user password
   */
  async changePassword(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const { newPassword } = req.body;
    const userId = req.user!.id;

    logger.info('Password change requested', { userId });

    await this.authService.changePassword(userId, newPassword);

    return this.success(res, { message: 'Password changed successfully' });
  }

  /**
   * GET /api/v1/auth/me
   * Get current user profile
   */
  async getProfile(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const userId = req.user!.id;

    logger.debug('Profile fetch requested', { userId });

    const profile = await this.authService.getProfile(userId);

    return this.success(res, profile);
  }
}
