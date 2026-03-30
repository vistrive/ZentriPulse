import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

const createSaasSchema = z.object({
  external_id: z.string().min(1),
  name: z.string().min(1),
  vendor: z.string().optional(),
  category: z.string().optional(),
  total_licenses: z.number().int().optional(),
  used_licenses: z.number().int().optional(),
  monthly_cost: z.number().optional(),
  is_sanctioned: z.boolean().optional(),
  raw_data: z.record(z.unknown()).optional(),
});

// GET /api/saas
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const sanctioned = req.query.sanctioned as string | undefined;

    let where = 'WHERE tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (sanctioned !== undefined) {
      where += ` AND is_sanctioned = $${idx++}`;
      params.push(sanctioned === 'true');
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM saas_applications ${where} ORDER BY name LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM saas_applications ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/saas/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM saas_applications WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'SaaS application');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/saas — upsert by external_id
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createSaasSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO saas_applications (tenant_id, external_id, name, vendor, category, total_licenses, used_licenses, monthly_cost, is_sanctioned, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, external_id) DO UPDATE SET
         name = EXCLUDED.name, vendor = EXCLUDED.vendor, category = EXCLUDED.category,
         total_licenses = EXCLUDED.total_licenses, used_licenses = EXCLUDED.used_licenses,
         monthly_cost = EXCLUDED.monthly_cost, is_sanctioned = EXCLUDED.is_sanctioned,
         raw_data = EXCLUDED.raw_data
       RETURNING *`,
      [
        req.tenantId, body.external_id, body.name,
        body.vendor || null, body.category || null,
        body.total_licenses ?? null, body.used_licenses ?? null,
        body.monthly_cost ?? null, body.is_sanctioned ?? true,
        body.raw_data ? JSON.stringify(body.raw_data) : null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/saas/reports/unused-licenses — apps with unused license capacity
router.get('/reports/unused-licenses', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT *, (total_licenses - used_licenses) AS unused,
              ROUND((1 - used_licenses::numeric / NULLIF(total_licenses, 0)) * 100, 1) AS waste_pct
       FROM saas_applications
       WHERE tenant_id = $1
         AND total_licenses IS NOT NULL
         AND used_licenses IS NOT NULL
         AND used_licenses < total_licenses
       ORDER BY (total_licenses - used_licenses) * COALESCE(monthly_cost, 0) / NULLIF(total_licenses, 0) DESC`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/saas/reports/shadow-it — unsanctioned applications
router.get('/reports/shadow-it', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM saas_applications
       WHERE tenant_id = $1 AND is_sanctioned = false
       ORDER BY last_usage_at DESC`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/saas/:id/license-assignments — per-user licenses for an app
router.get('/:id/license-assignments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const rows = await query(
      `SELECT la.*, i.display_name, i.department
       FROM saas_license_assignments la
       LEFT JOIN identities i ON i.id = la.identity_id
       WHERE la.saas_app_id = $1 AND la.tenant_id = $2
       ORDER BY la.last_active_at ASC NULLS FIRST
       LIMIT $3 OFFSET $4`,
      [req.params.id, req.tenantId, limit, offset],
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM saas_license_assignments WHERE saas_app_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
