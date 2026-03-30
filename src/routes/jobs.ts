import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// GET /api/jobs
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM scheduled_jobs WHERE tenant_id = $1 ORDER BY job_type`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/jobs
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      job_type: z.string().min(1),
      schedule_cron: z.string().min(1),
      timezone: z.string().optional(),
      config: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO scheduled_jobs (tenant_id, job_type, schedule_cron, timezone, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.tenantId, body.job_type, body.schedule_cron,
        body.timezone || 'Asia/Kolkata',
        JSON.stringify(body.config || {}),
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/jobs/:id
router.patch('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      schedule_cron: z.string().optional(),
      timezone: z.string().optional(),
      config: z.record(z.unknown()).optional(),
      is_active: z.boolean().optional(),
    }).parse(req.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(body)) {
      sets.push(`${key} = $${idx++}`);
      params.push(key === 'config' ? JSON.stringify(value) : value);
    }
    if (!sets.length) return ok(res, null);

    params.push(req.params.id, req.tenantId);
    const rows = await query(
      `UPDATE scheduled_jobs SET ${sets.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING *`,
      params,
    );
    if (!rows.length) return notFound(res, 'Job');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// DELETE /api/jobs/:id
router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `DELETE FROM scheduled_jobs WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Job');
    ok(res, { deleted: true });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
