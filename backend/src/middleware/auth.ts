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
      .from('profiles')
      .select('role, carrier_id')
      .eq('id', data.user.id)
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

/**
 * Middleware to check if user belongs to the same carrier as the resource.
 * Ensures multi-tenant data isolation.
 */
export function requireCarrierAccess() {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Extract carrier_id from request params or body
    const resourceCarrierId = req.params.carrier_id || req.body.carrier_id;

    if (resourceCarrierId && resourceCarrierId !== req.user.carrierId) {
      // Admins can access all carriers
      if (req.user.role !== 'admin') {
        res.status(403).json({ error: 'Access denied to this carrier' });
        return;
      }
    }

    next();
  };
}

/**
 * Middleware to check specific permissions beyond just roles.
 * Implements granular permission-based access control.
 */
export function requirePermissions(...permissions: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    // Define role-based permissions
    const rolePermissions: Record<string, string[]> = {
      admin: ['*'], // All permissions
      fleet_manager: [
        'view_drivers',
        'manage_drivers',
        'view_vehicles',
        'manage_vehicles',
        'view_events',
        'view_reports',
        'manage_carrier',
      ],
      driver: ['view_own_events', 'submit_events', 'view_own_logs', 'view_own_profile'],
      support: ['view_all', 'support_tickets', 'view_logs'],
    };

    const userPermissions = rolePermissions[req.user.role] || [];

    const hasPermission = permissions.every(
      (perm) => userPermissions.includes('*') || userPermissions.includes(perm)
    );

    if (!hasPermission) {
      res.status(403).json({
        error: 'Insufficient permissions',
        required: permissions,
      });
      return;
    }

    next();
  };
}
