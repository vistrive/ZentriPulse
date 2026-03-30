import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// GET /api/alerts
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;
    const priority = req.query.priority as string | undefined;

    let where = 'WHERE a.tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND a.status = $${idx++}`;
      params.push(status);
    }
    if (priority) {
      where += ` AND a.priority = $${idx++}`;
      params.push(priority);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT a.*, s.title as signal_title, s.severity as signal_severity,
              st.name as stakeholder_name
       FROM alerts a
       JOIN signals s ON s.id = a.signal_id
       JOIN stakeholders st ON st.id = a.stakeholder_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM alerts a ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/alerts
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      signal_id: z.string().uuid(),
      stakeholder_id: z.string().uuid(),
      channel: z.string().min(1),
      title: z.string().min(1),
      body: z.string().optional(),
      priority: z.enum(['urgent', 'high', 'normal', 'low']),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO alerts (tenant_id, signal_id, stakeholder_id, channel, title, body, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.tenantId, body.signal_id, body.stakeholder_id, body.channel, body.title, body.body || null, body.priority],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/alerts/:id/acknowledge
router.patch('/:id/acknowledge', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `UPDATE alerts SET status = 'acknowledged', acknowledged_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING *`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Alert');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
