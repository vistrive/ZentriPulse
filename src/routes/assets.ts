import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, notFound, serverError } from '../utils/response';

const router = Router();

const createAssetSchema = z.object({
  external_id: z.string().min(1),
  asset_type: z.string().min(1),
  hostname: z.string().optional(),
  serial_number: z.string().optional(),
  os: z.string().optional(),
  os_version: z.string().optional(),
  mtls_trust_status: z.enum(['trusted', 'untrusted', 'unknown', 'expired']).optional(),
  warranty_expiry: z.string().optional(),
  tags: z.array(z.string()).optional(),
  raw_data: z.record(z.unknown()).optional(),
});

// GET /api/assets
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const type = req.query.type as string | undefined;
    const trust = req.query.mtls_trust_status as string | undefined;

    let where = 'WHERE tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (type) {
      where += ` AND asset_type = $${idx++}`;
      params.push(type);
    }
    if (trust) {
      where += ` AND mtls_trust_status = $${idx++}`;
      params.push(trust);
    }

    params.push(limit, offset);
    const rows = await query(
      `SELECT * FROM assets ${where} ORDER BY updated_at DESC LIMIT $${idx++} OFFSET $${idx}`,
      params,
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM assets ${where}`,
      params.slice(0, -2),
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/assets/:id
router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT * FROM assets WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId],
    );
    if (!rows.length) return notFound(res, 'Asset');
    ok(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/assets — upsert by external_id
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = createAssetSchema.parse(req.body);
    const rows = await query(
      `INSERT INTO assets (tenant_id, external_id, asset_type, hostname, serial_number, os, os_version, mtls_trust_status, warranty_expiry, tags, raw_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (tenant_id, external_id) DO UPDATE SET
         asset_type = EXCLUDED.asset_type,
         hostname = EXCLUDED.hostname,
         serial_number = EXCLUDED.serial_number,
         os = EXCLUDED.os,
         os_version = EXCLUDED.os_version,
         mtls_trust_status = EXCLUDED.mtls_trust_status,
         warranty_expiry = EXCLUDED.warranty_expiry,
         tags = EXCLUDED.tags,
         raw_data = EXCLUDED.raw_data
       RETURNING *`,
      [
        req.tenantId, body.external_id, body.asset_type,
        body.hostname || null, body.serial_number || null,
        body.os || null, body.os_version || null,
        body.mtls_trust_status || null, body.warranty_expiry || null,
        JSON.stringify(body.tags || []),
        body.raw_data ? JSON.stringify(body.raw_data) : null,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/assets/expiring-warranties — warranties expiring in next N days
router.get('/reports/expiring-warranties', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 90;
    const rows = await query(
      `SELECT * FROM assets
       WHERE tenant_id = $1
         AND warranty_expiry IS NOT NULL
         AND warranty_expiry BETWEEN CURRENT_DATE AND CURRENT_DATE + $2 * INTERVAL '1 day'
       ORDER BY warranty_expiry`,
      [req.tenantId, days],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
