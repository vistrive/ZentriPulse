import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// ── Report Templates ───────────────────────────────────────────────────

// GET /api/reports/templates
router.get('/templates', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT rt.*, cf.name as framework_name
       FROM report_templates rt
       LEFT JOIN compliance_frameworks cf ON cf.id = rt.framework_id
       WHERE rt.tenant_id = $1
       ORDER BY rt.name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/reports/templates
router.post('/templates', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      report_type: z.string().min(1),
      framework_id: z.string().uuid().optional(),
      sections: z.array(z.record(z.unknown())),
      output_format: z.enum(['pdf', 'docx', 'html']).optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO report_templates (tenant_id, name, report_type, framework_id, sections, output_format)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.tenantId, body.name, body.report_type,
        body.framework_id || null, JSON.stringify(body.sections),
        body.output_format || 'pdf',
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Generated Reports ──────────────────────────────────────────────────

// GET /api/reports
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;

    let where = 'WHERE gr.tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND gr.status = $${idx++}`;
      params.push(status);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT gr.*, rt.name as template_name, rt.report_type,
              rev.name as reviewed_by_name, apr.name as approved_by_name
       FROM generated_reports gr
       JOIN report_templates rt ON rt.id = gr.template_id
       LEFT JOIN stakeholders rev ON rev.id = gr.reviewed_by
       LEFT JOIN stakeholders apr ON apr.id = gr.approved_by
       ${where}
       ORDER BY gr.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM generated_reports gr ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/reports/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT gr.*, rt.name as template_name, rt.report_type
       FROM generated_reports gr
       JOIN report_templates rt ON rt.id = gr.template_id
       WHERE gr.id = $1 AND gr.tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Report');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/reports — generate a report
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      template_id: z.string().uuid(),
      title: z.string().min(1),
      report_period_start: z.string().optional(),
      report_period_end: z.string().optional(),
      content: z.record(z.unknown()),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO generated_reports (tenant_id, template_id, title, report_period_start, report_period_end, content, generated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.tenantId, body.template_id, body.title,
        body.report_period_start || null, body.report_period_end || null,
        JSON.stringify(body.content), req.stakeholderId,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/reports/:id/status — move through review/approval workflow
router.patch('/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      status: z.enum(['in_review', 'approved', 'published', 'archived']),
    }).parse(req.body);

    let extraSets = '';
    const params: unknown[] = [body.status];
    if (body.status === 'in_review') {
      extraSets = ', reviewed_by = $4';
      params.push(req.params.id, req.tenantId, req.stakeholderId);
    } else if (body.status === 'approved') {
      extraSets = ', approved_by = $4, approved_at = now()';
      params.push(req.params.id, req.tenantId, req.stakeholderId);
    } else {
      params.push(req.params.id, req.tenantId);
    }

    const rows = await query(
      `UPDATE generated_reports SET status = $1${extraSets}
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      params,
    );
    if (!rows.length) return notFound(res, 'Report');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
