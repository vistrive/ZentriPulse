import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

const createContractSchema = z.object({
  external_id: z.string().min(1),
  vendor: z.string().min(1),
  title: z.string().min(1),
  contract_type: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  auto_renew: z.boolean().optional(),
  annual_value: z.number().optional(),
  currency: z.string().optional(),
  tc_risk_flags: z.array(z.record(z.unknown())).optional(),
  data_residency: z.string().optional(),
  linked_saas_ids: z.array(z.string()).optional(),
  raw_data: z.record(z.unknown()).optional(),
});

// GET /api/contracts
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const status = req.query.status as string | undefined;

    let where = 'WHERE tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (status) {
      where += ` AND status = $${idx++}`;
      params.push(status);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM contracts ${where} ORDER BY end_date ASC NULLS LAST LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM contracts ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/contracts/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM contracts WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Contract');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/contracts — upsert
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createContractSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO contracts (tenant_id, external_id, vendor, title, contract_type, start_date, end_date, auto_renew, annual_value, currency, tc_risk_flags, data_residency, linked_saas_ids, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (tenant_id, external_id) DO UPDATE SET
         vendor = EXCLUDED.vendor, title = EXCLUDED.title,
         contract_type = EXCLUDED.contract_type, start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date, auto_renew = EXCLUDED.auto_renew,
         annual_value = EXCLUDED.annual_value, currency = EXCLUDED.currency,
         tc_risk_flags = EXCLUDED.tc_risk_flags, data_residency = EXCLUDED.data_residency,
         linked_saas_ids = EXCLUDED.linked_saas_ids, raw_data = EXCLUDED.raw_data
       RETURNING *`,
      [
        req.tenantId, body.external_id, body.vendor, body.title,
        body.contract_type || null, body.start_date || null, body.end_date || null,
        body.auto_renew ?? false, body.annual_value ?? null, body.currency || 'INR',
        JSON.stringify(body.tc_risk_flags || []), body.data_residency || null,
        JSON.stringify(body.linked_saas_ids || []),
        body.raw_data ? JSON.stringify(body.raw_data) : null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/contracts/reports/expiring — contracts expiring in next N days
router.get('/reports/expiring', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 90;
    const rows = await query(
      `SELECT * FROM contracts
       WHERE tenant_id = $1
         AND end_date IS NOT NULL
         AND end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2 * INTERVAL '1 day'
       ORDER BY end_date`,
      [req.tenantId, days],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/contracts/reports/tc-risks — contracts with T&C risk flags
router.get('/reports/tc-risks', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM contracts
       WHERE tenant_id = $1 AND jsonb_array_length(tc_risk_flags) > 0
       ORDER BY end_date`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
