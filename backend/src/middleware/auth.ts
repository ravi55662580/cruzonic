import { Request, Response, NextFunction } from 'express';
import { supabase } from '../config/supabase';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    carrierId?: string;
  };
}

/**
 * Middleware to verify JWT token from Authorization header.
 * Attaches user info to request object.
 */
export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Missing authentication token' });
    return;
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      res.status(403).json({ error: 'Invalid or expired token' });
      return;
    }

    // Fetch user role and carrier association
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('role, carrier_id')
      .eq('user_id', data.user.id)
      .single();

    if (profileError) {
      res.status(500).json({ error: 'Failed to fetch user profile' });
      return;
    }

    req.user = {
      id: data.user.id,
      email: data.user.email || '',
      role: profile.role,
      carrierId: profile.carrier_id,
    };

    next();
  } catch (error) {
    res.status(500).json({ error: 'Authentication failed' });
  }
}

/**
 * Middleware to check if user has required role.
 */
export function requireRole(...allowedRoles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
