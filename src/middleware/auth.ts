import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthenticatedRequest } from '../types';
import { unauthorized } from '../utils/response';

interface JwtPayload {
  tenantId: string;
  stakeholderId: string;
  stakeholderRole: string;
}

/**
 * Verify JWT and inject tenant context into the request.
 * Token format: Bearer <jwt>
 * JWT payload must contain: tenantId, stakeholderId, stakeholderRole
 */
export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    unauthorized(res, 'Missing or malformed Authorization header');
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    req.tenantId = payload.tenantId;
    req.stakeholderId = payload.stakeholderId;
    req.stakeholderRole = payload.stakeholderRole;
    next();
  } catch {
    unauthorized(res, 'Invalid or expired token');
  }
}
