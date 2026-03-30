import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

const createTenantSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  parent_id: z.string().uuid().optional(),
  settings: z.record(z.unknown()).optional(),
});

const updateTenantSchema = createTenantSchema.partial();

// GET /api/tenants — list tenants (scoped to current tenant + children)
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const rows = await query(
      `SELECT * FROM tenants
       WHERE id = $1 OR parent_id = $1
       ORDER BY name
       LIMIT $2 OFFSET $3`,
      [req.tenantId, limit, offset],
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM tenants WHERE id = $1 OR parent_id = $1`,
      [req.tenantId],
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/tenants/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM tenants WHERE id = $1 AND (id = $2 OR parent_id = $2)`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Tenant');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/tenants
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createTenantSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO tenants (name, slug, parent_id, settings)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [body.name, body.slug, body.parent_id || req.tenantId, body.settings || {}],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/tenants/:id
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = updateTenantSchema.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(body)) {
      sets.push(`${key} = $${idx++}`);
      params.push(key === 'settings' ? JSON.stringify(value) : value);
    }
    if (!sets.length) return ok(res, null);

    params.push(req.params.id, req.tenantId);
    const rows = await query(
      `UPDATE tenants SET ${sets.join(', ')}
       WHERE id = $${idx++} AND (id = $${idx} OR parent_id = $${idx})
       RETURNING *`,
      params,
    );
    if (!rows.length) return notFound(res, 'Tenant');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
