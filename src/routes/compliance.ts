import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// ── Frameworks ─────────────────────────────────────────────────────────

// GET /api/compliance/frameworks
router.get('/frameworks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM compliance_frameworks WHERE tenant_id = $1 ORDER BY name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/compliance/frameworks/:id
router.get('/frameworks/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM compliance_frameworks WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Framework');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/compliance/frameworks — upsert
router.post('/frameworks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      external_id: z.string().min(1),
      name: z.string().min(1),
      version: z.string().optional(),
      overall_score: z.number().min(0).max(100).optional(),
      total_controls: z.number().int().optional(),
      passing_controls: z.number().int().optional(),
      raw_data: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO compliance_frameworks (tenant_id, external_id, name, version, overall_score, total_controls, passing_controls, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, external_id) DO UPDATE SET
         name = EXCLUDED.name, version = EXCLUDED.version,
         overall_score = EXCLUDED.overall_score,
         total_controls = EXCLUDED.total_controls,
         passing_controls = EXCLUDED.passing_controls,
         raw_data = EXCLUDED.raw_data
       RETURNING *`,
      [
        req.tenantId, body.external_id, body.name, body.version || null,
        body.overall_score ?? null, body.total_controls ?? 0, body.passing_controls ?? 0,
        body.raw_data ? JSON.stringify(body.raw_data) : null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Controls ───────────────────────────────────────────────────────────

// GET /api/compliance/frameworks/:frameworkId/controls
router.get('/frameworks/:frameworkId/controls', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;

    let where = 'WHERE tenant_id = $1 AND framework_id = $2';
    const params: unknown[] = [req.tenantId, req.params.frameworkId];
    let idx = 3;

    if (status) {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM compliance_controls ${where} ORDER BY control_ref LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM compliance_controls ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/compliance/controls — upsert
router.post('/controls', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      framework_id: z.string().uuid(),
      external_id: z.string().min(1),
      control_ref: z.string().min(1),
      title: z.string().min(1),
      status: z.enum(['passing', 'failing', 'not_assessed', 'not_applicable']),
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      evidence_links: z.array(z.string()).optional(),
      linked_asset_ids: z.array(z.string()).optional(),
      raw_data: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO compliance_controls (tenant_id, framework_id, external_id, control_ref, title, status, severity, evidence_links, linked_asset_ids, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tenant_id, external_id) DO UPDATE SET
         control_ref = EXCLUDED.control_ref, title = EXCLUDED.title,
         status = EXCLUDED.status, severity = EXCLUDED.severity,
         evidence_links = EXCLUDED.evidence_links,
         linked_asset_ids = EXCLUDED.linked_asset_ids,
         raw_data = EXCLUDED.raw_data
       RETURNING *`,
      [
        req.tenantId, body.framework_id, body.external_id,
        body.control_ref, body.title, body.status,
        body.severity || null,
        JSON.stringify(body.evidence_links || []),
        JSON.stringify(body.linked_asset_ids || []),
        body.raw_data ? JSON.stringify(body.raw_data) : null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Deadlines ──────────────────────────────────────────────────────────

// GET /api/compliance/deadlines
router.get('/deadlines', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    let where = 'WHERE cd.tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND cd.status = $${idx++}`;
      params.push(status);
    }

    const rows = await query(
      `SELECT cd.*, cf.name as framework_name, s.name as responsible_name
       FROM compliance_deadlines cd
       JOIN compliance_frameworks cf ON cf.id = cd.framework_id
       LEFT JOIN stakeholders s ON s.id = cd.responsible_stakeholder_id
       ${where}
       ORDER BY cd.deadline_date`,
      params,
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/compliance/deadlines
router.post('/deadlines', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      framework_id: z.string().uuid(),
      title: z.string().min(1),
      deadline_date: z.string(),
      status: z.enum(['upcoming', 'at_risk', 'overdue', 'completed']).optional(),
      responsible_stakeholder_id: z.string().uuid().optional(),
      notes: z.string().optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO compliance_deadlines (tenant_id, framework_id, title, deadline_date, status, responsible_stakeholder_id, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.tenantId, body.framework_id, body.title, body.deadline_date,
        body.status || 'upcoming', body.responsible_stakeholder_id || null, body.notes || null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
