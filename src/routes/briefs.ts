import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// ── Brief Templates ────────────────────────────────────────────────────

// GET /api/briefs/templates
router.get('/templates', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT bt.*, sr.name as role_name
       FROM brief_templates bt
       LEFT JOIN stakeholder_roles sr ON sr.id = bt.role_id
       WHERE bt.tenant_id = $1
       ORDER BY bt.name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/briefs/templates
router.post('/templates', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      name: z.string().min(1),
      role_id: z.string().uuid().optional(),
      sections: z.array(z.record(z.unknown())),
      format: z.enum(['html', 'markdown', 'pdf']).optional(),
      is_default: z.boolean().optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO brief_templates (tenant_id, name, role_id, sections, format, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.tenantId, body.name, body.role_id || null,
        JSON.stringify(body.sections), body.format || 'html', body.is_default ?? false,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Briefs ─────────────────────────────────────────────────────────────

// GET /api/briefs
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const date = req.query.date as string | undefined;
    const stakeholderId = req.query.stakeholder_id as string | undefined;

    let where = 'WHERE b.tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (date) {
      where += ` AND b.brief_date = $${idx++}`;
      params.push(date);
    }
    if (stakeholderId) {
      where += ` AND b.stakeholder_id = $${idx++}`;
      params.push(stakeholderId);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT b.*, s.name as stakeholder_name, s.email as stakeholder_email
       FROM briefs b
       JOIN stakeholders s ON s.id = b.stakeholder_id
       ${where}
       ORDER BY b.brief_date DESC, s.name
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM briefs b ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/briefs/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT b.*, s.name as stakeholder_name
       FROM briefs b
       JOIN stakeholders s ON s.id = b.stakeholder_id
       WHERE b.id = $1 AND b.tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Brief');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/briefs — create a brief (typically called by scheduler)
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      stakeholder_id: z.string().uuid(),
      template_id: z.string().uuid().optional(),
      brief_date: z.string(),
      title: z.string().min(1),
      content: z.record(z.unknown()),
      signal_ids: z.array(z.string()).optional(),
      delivery_channel: z.string().optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO briefs (tenant_id, stakeholder_id, template_id, brief_date, title, content, signal_ids, delivery_channel)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.tenantId, body.stakeholder_id, body.template_id || null,
        body.brief_date, body.title, JSON.stringify(body.content),
        JSON.stringify(body.signal_ids || []),
        body.delivery_channel || 'email',
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/briefs/:id/read — mark brief as read
router.patch('/:id/read', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `UPDATE briefs SET status = 'read', read_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Brief');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
