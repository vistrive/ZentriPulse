import { Router, Response } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { AuthenticatedRequest } from '../types';
import { parsePagination } from '../utils/pagination';
import { ok, created, serverError } from '../utils/response';

const router = Router();

// GET /api/nl-queries — query history for current stakeholder
router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { limit, offset, page } = parsePagination(req);
    const rows = await query(
      `SELECT * FROM nl_queries
       WHERE tenant_id = $1 AND stakeholder_id = $2
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [req.tenantId, req.stakeholderId, limit, offset],
    );
    const [{ count }] = await query<{ count: string }>(
      `SELECT count(*) FROM nl_queries WHERE tenant_id = $1 AND stakeholder_id = $2`,
      [req.tenantId, req.stakeholderId],
    );
    ok(res, rows, { page, limit, total: parseInt(count, 10) });
  } catch (err) {
    serverError(res, err);
  }
});

// POST /api/nl-queries — submit a natural language query
router.post('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      query_text: z.string().min(1).max(2000),
    }).parse(req.body);

    // TODO: Integrate with AI reasoning engine to generate:
    //   - reasoning_trace
    //   - generated_sql
    //   - result_summary
    //   - domains_queried
    // For now, store the query and return a placeholder.

    const startTime = Date.now();
    const rows = await query(
      `INSERT INTO nl_queries (tenant_id, stakeholder_id, query_text, reasoning_trace, domains_queried, response_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.tenantId, req.stakeholderId, body.query_text,
        JSON.stringify({ status: 'pending', steps: [] }),
        JSON.stringify([]),
        Date.now() - startTime,
      ],
    );
    created(res, rows[0]);
  } catch (err) {
    serverError(res, err);
  }
});

// PATCH /api/nl-queries/:id/feedback
router.patch('/:id/feedback', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = z.object({
      feedback: z.enum(['helpful', 'not_helpful']),
    }).parse(req.body);

    const rows = await query(
      `UPDATE nl_queries SET feedback = $1
       WHERE id = $2 AND tenant_id = $3 AND stakeholder_id = $4
       RETURNING *`,
      [body.feedback, req.params.id, req.tenantId, req.stakeholderId],
    );
    ok(res, rows[0] || null);
  } catch (err) {
    serverError(res, err);
  }
});

export default router;
