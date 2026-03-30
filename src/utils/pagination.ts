import { Request } from 'express';
import { PaginationParams } from '../types';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export function parsePagination(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}
