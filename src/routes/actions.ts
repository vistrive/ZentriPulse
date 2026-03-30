import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

// ── Kill Switch Actions ────────────────────────────────────────────────

// GET /api/actions/kill-switch
router.get('/kill-switch', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;

    let where = 'WHERE ks.tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND ks.status = $${idx++}`;
      params.push(status);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT ks.*, s.title as signal_title, st.name as approved_by_name
       FROM kill_switch_actions ks
       LEFT JOIN signals s ON s.id = ks.signal_id
       LEFT JOIN stakeholders st ON st.id = ks.approved_by
       ${where}
       ORDER BY ks.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM kill_switch_actions ks ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/actions/kill-switch — request a kill switch action
router.post('/kill-switch', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      signal_id: z.string().uuid().optional(),
      action_type: z.string().min(1),
      target_type: z.string().min(1),
      target_id: z.string().min(1),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO kill_switch_actions (tenant_id, signal_id, action_type, target_type, target_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.tenantId, body.signal_id || null, body.action_type, body.target_type, body.target_id],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/actions/kill-switch/:id/approve
router.patch('/kill-switch/:id/approve', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `UPDATE kill_switch_actions SET status = 'approved', approved_by = $1
       WHERE id = $2 AND tenant_id = $3 AND status = 'pending'
       RETURNING *`,
      [req.stakeholderId, req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Kill switch action');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/actions/kill-switch/:id/execute — mark as executed (called after AssetZentri API call)
router.patch('/kill-switch/:id/execute', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      api_response: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const rows = await query(
      `UPDATE kill_switch_actions SET status = 'executed', executed_at = now(), api_response = $1
       WHERE id = $2 AND tenant_id = $3 AND status = 'approved'
       RETURNING *`,
      [body.api_response ? JSON.stringify(body.api_response) : null, req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Kill switch action');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/actions/kill-switch/:id/rollback
router.patch('/kill-switch/:id/rollback', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `UPDATE kill_switch_actions SET status = 'rolled_back', rollback_at = now()
       WHERE id = $1 AND tenant_id = $2 AND status = 'executed'
       RETURNING *`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Kill switch action');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Risk Predictions ───────────────────────────────────────────────────

// GET /api/actions/predictions
router.get('/predictions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;

    let where = 'WHERE tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }
    if (type) {
      where += ` AND prediction_type = $${idx++}`;
      params.push(type);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM risk_predictions ${where}
       ORDER BY confidence DESC, predicted_date
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM risk_predictions ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/actions/predictions
router.post('/predictions', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      prediction_type: z.string().min(1),
      entity_type: z.string().min(1),
      entity_id: z.string().uuid().optional(),
      predicted_date: z.string().optional(),
      confidence: z.number().min(0).max(100),
      description: z.string().min(1),
      recommended_action: z.string().optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO risk_predictions (tenant_id, prediction_type, entity_type, entity_id, predicted_date, confidence, description, recommended_action)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.tenantId, body.prediction_type, body.entity_type,
        body.entity_id || null, body.predicted_date || null,
        body.confidence, body.description, body.recommended_action || null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Audit Log ──────────────────────────────────────────────────────────

// GET /api/actions/audit-log
router.get('/audit-log', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const action = req.query.action as string | undefined;
    const resourceType = req.query.resource_type as string | undefined;

    let where = 'WHERE tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (action) {
      where += ` AND action = $${idx++}`;
      params.push(action);
    }
    if (resourceType) {
      where += ` AND resource_type = $${idx++}`;
      params.push(resourceType);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM audit_log ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
