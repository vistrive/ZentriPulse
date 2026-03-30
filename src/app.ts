import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { authenticate } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { AuthenticatedRequest } from './types';

import tenantRoutes from './routes/tenants';
import stakeholderRoutes from './routes/stakeholders';
import connectionRoutes from './routes/connections';
import assetRoutes from './routes/assets';
import saasRoutes from './routes/saas';
import complianceRoutes from './routes/compliance';
import contractRoutes from './routes/contracts';
import identityRoutes from './routes/identities';
import signalRoutes from './routes/signals';
import briefRoutes from './routes/briefs';
import alertRoutes from './routes/alerts';
import nlQueryRoutes from './routes/nlQueries';
import reportRoutes from './routes/reports';
import actionRoutes from './routes/actions';
import notificationRoutes from './routes/notifications';
import snapshotRoutes from './routes/snapshots';
import jobRoutes from './routes/jobs';

const app = express();

// ── Global middleware ──────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('short'));

// ── Health check (no auth) ─────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'zentripulse', timestamp: new Date().toISOString() });
});

// ── Authenticated routes ───────────────────────────────────────────────
app.use('/api', authenticate as express.RequestHandler);

app.use('/api/tenants', tenantRoutes as express.Router);
app.use('/api/stakeholders', stakeholderRoutes as express.Router);
app.use('/api/stakeholder-roles', stakeholderRoutes as express.Router);  // alias for /roles sub-routes
app.use('/api/connections', connectionRoutes as express.Router);
app.use('/api/assets', assetRoutes as express.Router);
app.use('/api/saas', saasRoutes as express.Router);
app.use('/api/compliance', complianceRoutes as express.Router);
app.use('/api/contracts', contractRoutes as express.Router);
app.use('/api/identities', identityRoutes as express.Router);
app.use('/api/signals', signalRoutes as express.Router);
app.use('/api/briefs', briefRoutes as express.Router);
app.use('/api/alerts', alertRoutes as express.Router);
app.use('/api/nl-queries', nlQueryRoutes as express.Router);
app.use('/api/reports', reportRoutes as express.Router);
app.use('/api/actions', actionRoutes as express.Router);
app.use('/api/notifications', notificationRoutes as express.Router);
app.use('/api/snapshots', snapshotRoutes as express.Router);
app.use('/api/jobs', jobRoutes as express.Router);

// ── Error handler ──────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
