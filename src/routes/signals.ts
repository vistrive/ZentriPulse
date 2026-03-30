import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

const severityEnum = z.enum(['critical', 'high', 'medium', 'low', 'info']);

// ── Fusion Rules ───────────────────────────────────────────────────────

const createRuleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  domains: z.array(z.string()),
  condition_logic: z.record(z.unknown()),
  severity: severityEnum,
  cooldown_minutes: z.number().int().min(1).optional(),
});

// GET /api/signals/rules
router.get('/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM fusion_rules WHERE tenant_id = $1 ORDER BY severity, name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/signals/rules
router.post('/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createRuleSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO fusion_rules (tenant_id, name, description, domains, condition_logic, severity, cooldown_minutes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.tenantId, body.name, body.description || null,
        JSON.stringify(body.domains), JSON.stringify(body.condition_logic),
        body.severity, body.cooldown_minutes || 60,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/signals/rules/:id — toggle active, update logic
router.patch('/rules/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      name: z.string().optional(),
      description: z.string().optional(),
      domains: z.array(z.string()).optional(),
      condition_logic: z.record(z.unknown()).optional(),
      severity: severityEnum.optional(),
      is_active: z.boolean().optional(),
      cooldown_minutes: z.number().int().optional(),
    }).parse(req.body);

    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const [key, value] of Object.entries(body)) {
      sets.push(`${key} = $${idx++}`);
      params.push(['domains', 'condition_logic'].includes(key) ? JSON.stringify(value) : value);
    }
    if (!sets.length) return ok(res, null);

    params.push(req.params.id, req.tenantId);
    const rows = await query(
      `UPDATE fusion_rules SET ${sets.join(', ')}
       WHERE id = $${idx++} AND tenant_id = $${idx}
       RETURNING *`,
      params,
    );
    if (!rows.length) return notFound(res, 'Fusion rule');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Signals ────────────────────────────────────────────────────────────

// GET /api/signals
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;
    const severity = req.query.severity as string | undefined;
    const domain = req.query.domain as string | undefined;

    let where = 'WHERE s.tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND s.status = $${idx++}`;
      params.push(status);
    }
    if (severity) {
      where += ` AND s.severity = $${idx++}`;
      params.push(severity);
    }
    if (domain) {
      where += ` AND s.domains @> $${idx++}::jsonb`;
      params.push(JSON.stringify([domain]));
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT s.*, fr.name as rule_name
       FROM signals s
       LEFT JOIN fusion_rules fr ON fr.id = s.rule_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM signals s ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/signals/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT s.*, fr.name as rule_name
       FROM signals s
       LEFT JOIN fusion_rules fr ON fr.id = s.rule_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Signal');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/signals
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      rule_id: z.string().uuid().optional(),
      signal_type: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      severity: severityEnum,
      domains: z.array(z.string()),
      source_entities: z.array(z.record(z.unknown())).optional(),
      raw_data: z.record(z.unknown()).optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO signals (tenant_id, rule_id, signal_type, title, description, severity, domains, source_entities, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.tenantId, body.rule_id || null, body.signal_type,
        body.title, body.description || null, body.severity,
        JSON.stringify(body.domains),
        JSON.stringify(body.source_entities || []),
        body.raw_data ? JSON.stringify(body.raw_data) : null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/signals/:id/status — acknowledge, resolve, dismiss
router.patch('/:id/status', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      status: z.enum(['acknowledged', 'resolved', 'dismissed']),
    }).parse(req.body);

    const resolvedAt = body.status === 'resolved' ? 'now()' : 'resolved_at';
    const rows = await query(
      `UPDATE signals SET status = $1, resolved_at = ${body.status === 'resolved' ? 'now()' : 'resolved_at'}
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [body.status, req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Signal');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Signal Comments ────────────────────────────────────────────────────

// GET /api/signals/:id/comments
router.get('/:id/comments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT sc.*, s.name as stakeholder_name
       FROM signal_comments sc
       JOIN stakeholders s ON s.id = sc.stakeholder_id
       WHERE sc.signal_id = $1 AND sc.tenant_id = $2
       ORDER BY sc.created_at`,
      [req.params.id, req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/signals/:id/comments
router.post('/:id/comments', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      comment_text: z.string().min(1),
      is_internal: z.boolean().optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO signal_comments (tenant_id, signal_id, stakeholder_id, comment_text, is_internal)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.tenantId, req.params.id, req.stakeholderId, body.comment_text, body.is_internal ?? false],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// ── Routing Rules ──────────────────────────────────────────────────────

// GET /api/signals/routing
router.get('/routing/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT srr.*, sr.name as role_name
       FROM signal_routing_rules srr
       JOIN stakeholder_roles sr ON sr.id = srr.role_id
       WHERE srr.tenant_id = $1
       ORDER BY sr.name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/signals/routing
router.post('/routing/rules', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      role_id: z.string().uuid(),
      signal_type: z.string().optional(),
      min_severity: severityEnum.optional(),
      domains: z.array(z.string()).optional(),
      delivery_mode: z.enum(['realtime', 'brief', 'digest', 'silent']).optional(),
      channel: z.string().optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO signal_routing_rules (tenant_id, role_id, signal_type, min_severity, domains, delivery_mode, channel)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.tenantId, body.role_id, body.signal_type || null,
        body.min_severity || 'low',
        JSON.stringify(body.domains || []),
        body.delivery_mode || 'brief',
        body.channel || 'email',
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
