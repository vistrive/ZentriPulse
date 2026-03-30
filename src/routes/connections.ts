import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

const domainEnum = z.enum(['it_assets', 'saas', 'compliance', 'contracts', 'identity']);

const createConnectionSchema = z.object({
  domain: domainEnum,
  base_url: z.string().url(),
  auth_config: z.record(z.unknown()).optional(),
  sync_interval_minutes: z.number().int().min(5).max(1440).optional(),
});

// GET /api/connections — list API connections for tenant
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, tenant_id, domain, base_url, sync_interval_minutes, is_active, last_sync_at, created_at, updated_at
       FROM api_connections WHERE tenant_id = $1 ORDER BY domain`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/connections
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createConnectionSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO api_connections (tenant_id, domain, base_url, auth_config, sync_interval_minutes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, domain, base_url, sync_interval_minutes, is_active, created_at`,
      [req.tenantId, body.domain, body.base_url, JSON.stringify(body.auth_config || {}), body.sync_interval_minutes || 60],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/connections/:id — toggle active, update interval
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      base_url: z.string().url().optional(),
      auth_config: z.record(z.unknown()).optional(),
      sync_interval_minutes: z.number().int().min(5).max(1440).optional(),
      is_active: z.boolean().optional(),
    }).parse(req.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(body)) {
      sets.push(`${key} = $${idx++}`);
      params.push(key === 'auth_config' ? JSON.stringify(value) : value);
    }
    if (!sets.length) return ok(res, null);

    params.push(req.params.id, req.tenantId);
    const rows = await query(
      `UPDATE api_connections SET ${sets.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING id, tenant_id, domain, base_url, sync_interval_minutes, is_active, updated_at`,
      params,
    );
    if (!rows.length) return notFound(res, 'Connection');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/connections/:id/sync-logs — recent sync history
router.get('/:id/sync-logs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM sync_logs
       WHERE connection_id = $1 AND tenant_id = $2
       ORDER BY started_at DESC
       LIMIT 50`,
      [req.params.id, req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
