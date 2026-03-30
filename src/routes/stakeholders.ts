import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// ── Stakeholder Roles ──────────────────────────────────────────────────

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  signal_preferences: z.record(z.unknown()).optional(),
  brief_template_id: z.string().uuid().optional(),
});

// GET /api/stakeholder-roles
router.get('/roles', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM stakeholder_roles WHERE tenant_id = $1 ORDER BY name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/stakeholder-roles
router.post('/roles', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createRoleSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO stakeholder_roles (tenant_id, name, signal_preferences, brief_template_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [req.tenantId, body.name, JSON.stringify(body.signal_preferences || {}), body.brief_template_id || null],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Stakeholders ───────────────────────────────────────────────────────

const createStakeholderSchema = z.object({
  role_id: z.string().uuid(),
  external_id: z.string().optional(),
  name: z.string().min(1).max(255),
  email: z.string().email(),
  notification_channels: z.array(z.string()).optional(),
  timezone: z.string().optional(),
});

const updateStakeholderSchema = createStakeholderSchema.partial();

// GET /api/stakeholders
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const rows = await query(
      `SELECT s.*, sr.name as role_name
       FROM stakeholders s
       JOIN stakeholder_roles sr ON sr.id = s.role_id
       WHERE s.tenant_id = $1
       ORDER BY s.name
       LIMIT $2 OFFSET $3`,
      [req.tenantId, limit, offset],
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM stakeholders WHERE tenant_id = $1`,
      [req.tenantId],
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/stakeholders/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT s.*, sr.name as role_name
       FROM stakeholders s
       JOIN stakeholder_roles sr ON sr.id = s.role_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Stakeholder');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/stakeholders
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createStakeholderSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO stakeholders (tenant_id, role_id, external_id, name, email, notification_channels, timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.tenantId, body.role_id, body.external_id || null,
        body.name, body.email,
        JSON.stringify(body.notification_channels || ['email']),
        body.timezone || 'Asia/Kolkata',
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/stakeholders/:id
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = updateStakeholderSchema.parse(req.body);
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(body)) {
      if (key === 'notification_channels') {
        sets.push(`${key} = $${idx++}`);
        params.push(JSON.stringify(value));
      } else {
        sets.push(`${key} = $${idx++}`);
        params.push(value);
      }
    }
    if (!sets.length) return ok(res, null);

    params.push(req.params.id, req.tenantId);
    const rows = await query(
      `UPDATE stakeholders SET ${sets.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING *`,
      params,
    );
    if (!rows.length) return notFound(res, 'Stakeholder');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
