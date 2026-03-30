import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { ok, created, serverError } from '../utils/response';

const router = Router();

// GET /api/snapshots — query time-series metrics
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const domain = req.query.domain as string | undefined;
    const metricName = req.query.metric_name as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    let where = 'WHERE tenant_id = $1';
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    if (domain) {
      where += ` AND domain = $${idx++}`;
      params.push(domain);
    }
    if (metricName) {
      where += ` AND metric_name = $${idx++}`;
      params.push(metricName);
    }
    if (from) {
      where += ` AND snapshot_date >= $${idx++}`;
      params.push(from);
    }
    if (to) {
      where += ` AND snapshot_date <= $${idx++}`;
      params.push(to);
    }

    const rows = await query(
      `SELECT * FROM data_snapshots ${where} ORDER BY snapshot_date DESC LIMIT 1000`,
      params,
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// GET /api/snapshots/metrics — list available metric names
router.get('/metrics', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await query(
      `SELECT DISTINCT domain, metric_name, count(*) as data_points,
              min(snapshot_date) as first_date, max(snapshot_date) as last_date
       FROM data_snapshots
       WHERE tenant_id = $1
       GROUP BY domain, metric_name
       ORDER BY domain, metric_name`,
      [req.tenantId],
    );
    ok(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/snapshots — record a metric snapshot (typically called by scheduler)
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      domain: z.enum(['it_assets', 'saas', 'compliance', 'contracts', 'identity', 'overall']),
      metric_name: z.string().min(1),
      metric_value: z.number(),
      dimensions: z.record(z.unknown()).optional(),
      snapshot_date: z.string().optional(),
    }).parse(req.body);

    const rows = await query(
      `INSERT INTO data_snapshots (tenant_id, domain, metric_name, metric_value, dimensions, snapshot_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT ON CONSTRAINT idx_snapshots_unique DO UPDATE SET
         metric_value = EXCLUDED.metric_value
       RETURNING *`,
      [
        req.tenantId, body.domain, body.metric_name, body.metric_value,
        JSON.stringify(body.dimensions || {}),
        body.snapshot_date || new Date().toISOString().split('T')[0],
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/snapshots/bulk — batch record multiple snapshots
router.post('/bulk', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      snapshots: z.array(z.object({
        domain: z.enum(['it_assets', 'saas', 'compliance', 'contracts', 'identity', 'overall']),
        metric_name: z.string().min(1),
        metric_value: z.number(),
        dimensions: z.record(z.unknown()).optional(),
        snapshot_date: z.string().optional(),
      })),
    }).parse(req.body);

    const today = new Date().toISOString().split('T')[0];
    const values: string[] = [];
    const params: unknown[] = [req.tenantId];
    let idx = 2;

    for (const snap of body.snapshots) {
      values.push(`($1, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(snap.domain, snap.metric_name, snap.metric_value, JSON.stringify(snap.dimensions || {}), snap.snapshot_date || today);
    }

    const rows = await query(
      `INSERT INTO data_snapshots (tenant_id, domain, metric_name, metric_value, dimensions, snapshot_date)
       VALUES ${values.join(', ')}
       ON CONFLICT ON CONSTRAINT idx_snapshots_unique DO UPDATE SET
         metric_value = EXCLUDED.metric_value
       RETURNING *`,
      params,
    );
    created(res, rows);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
