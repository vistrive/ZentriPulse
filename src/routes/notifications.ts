import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// ── Channel Configs ────────────────────────────────────────────────────

// GET /api/notifications/channels
router.get('/channels', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT id, tenant_id, channel_type, name, is_active, is_verified, last_tested_at, created_at
       FROM notification_channel_configs
       WHERE tenant_id = $1
       ORDER BY channel_type, name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/notifications/channels
router.post('/channels', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      channel_type: z.enum(['email', 'slack', 'teams', 'webhook', 'in_app']),
      name: z.string().min(1),
      config: z.record(z.unknown()),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO notification_channel_configs (tenant_id, channel_type, name, config)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tenant_id, channel_type, name, is_active, is_verified, created_at`,
      [req.tenantId, body.channel_type, body.name, JSON.stringify(body.config)],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/notifications/channels/:id
router.patch('/channels/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      name: z.string().optional(),
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
      `UPDATE notification_channel_configs SET ${sets.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING id, tenant_id, channel_type, name, is_active, is_verified, updated_at`,
      params,
    );
    if (!rows.length) return notFound(res, 'Channel config');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/notifications/channels/:id/test — mark channel as tested
router.post('/channels/:id/test', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // TODO: Actually send a test notification via the channel
    const rows = await query(
      `UPDATE notification_channel_configs SET is_verified = true, last_tested_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, channel_type, name, is_verified, last_tested_at`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Channel config');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Notification Log ───────────────────────────────────────────────────

// GET /api/notifications/log
router.get('/log', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;
    const sourceType = req.query.source_type as string | undefined;

    let where = 'WHERE nl.tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND nl.status = $${idx++}`;
      params.push(status);
    }
    if (sourceType) {
      where += ` AND nl.source_type = $${idx++}`;
      params.push(sourceType);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT nl.*, s.name as recipient_name, s.email as recipient_email
       FROM notification_log nl
       JOIN stakeholders s ON s.id = nl.recipient_id
       ${where}
       ORDER BY nl.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM notification_log nl ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
