import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

const createIdentitySchema = z.object({
  external_id: z.string().min(1),
  email: z.string().email(),
  display_name: z.string().optional(),
  department: z.string().optional(),
  role: z.string().optional(),
  mfa_enabled: z.boolean().optional(),
  jit_access_active: z.boolean().optional(),
  sod_conflicts: z.array(z.record(z.unknown())).optional(),
  risk_score: z.number().min(0).max(100).optional(),
  raw_data: z.record(z.unknown()).optional(),
});

// GET /api/identities
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;
    const mfa = req.query.mfa_enabled as string | undefined;

    let where = 'WHERE tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }
    if (mfa !== undefined) {
      where += ` AND mfa_enabled = $${idx++}`;
      params.push(mfa === 'true');
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM identities ${where} ORDER BY risk_score DESC NULLS LAST LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM identities ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/identities/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM identities WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Identity');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/identities — upsert
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createIdentitySchema.parse(req.body);
    const rows = await query(
      `INSERT INTO identities (tenant_id, external_id, email, display_name, department, role, mfa_enabled, jit_access_active, sod_conflicts, risk_score, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (tenant_id, external_id) DO UPDATE SET
         email = EXCLUDED.email, display_name = EXCLUDED.display_name,
         department = EXCLUDED.department, role = EXCLUDED.role,
         mfa_enabled = EXCLUDED.mfa_enabled, jit_access_active = EXCLUDED.jit_access_active,
         sod_conflicts = EXCLUDED.sod_conflicts, risk_score = EXCLUDED.risk_score,
         raw_data = EXCLUDED.raw_data
       RETURNING *`,
      [
        req.tenantId, body.external_id, body.email,
        body.display_name || null, body.department || null, body.role || null,
        body.mfa_enabled ?? false, body.jit_access_active ?? false,
        JSON.stringify(body.sod_conflicts || []),
        body.risk_score ?? 0,
        body.raw_data ? JSON.stringify(body.raw_data) : null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/identities/reports/high-risk — identities with risk_score > threshold
router.get('/reports/high-risk', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const threshold = parseFloat(req.query.threshold as string) || 70;
    const rows = await query(
      `SELECT * FROM identities
       WHERE tenant_id = $1 AND risk_score >= $2
       ORDER BY risk_score DESC`,
      [req.tenantId, threshold],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/identities/reports/sod-conflicts — identities with SoD violations
router.get('/reports/sod-conflicts', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM identities
       WHERE tenant_id = $1 AND jsonb_array_length(sod_conflicts) > 0
       ORDER BY risk_score DESC`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/identities/reports/no-mfa — active identities without MFA
router.get('/reports/no-mfa', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM identities
       WHERE tenant_id = $1 AND mfa_enabled = false AND status = 'active'
       ORDER BY risk_score DESC`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
