-- ZentriPulse Database Schema — Migration 002
-- Additional tables to complete feature coverage
-- 6 new tables + missing indexes from migration 001

BEGIN;

-- =============================================================================
-- Missing indexes from migration 001
-- =============================================================================

CREATE INDEX idx_fusion_rules_tenant ON fusion_rules(tenant_id);
CREATE INDEX idx_kill_switch_tenant ON kill_switch_actions(tenant_id);
CREATE INDEX idx_brief_templates_tenant ON brief_templates(tenant_id);

-- =============================================================================
-- 14. Notification Channel Configs — Slack, Teams, SMTP, webhook connection settings per tenant
-- =============================================================================

CREATE TABLE notification_channel_configs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    channel_type    TEXT NOT NULL CHECK (channel_type IN ('email', 'slack', 'teams', 'webhook', 'in_app')),
    name            TEXT NOT NULL,                            -- e.g. "#it-alerts", "Security Team Webhook"
    config          JSONB NOT NULL DEFAULT '{}',              -- smtp_host, webhook_url, slack_token, etc.
    is_active       BOOLEAN NOT NULL DEFAULT true,
    is_verified     BOOLEAN NOT NULL DEFAULT false,           -- connection tested successfully
    last_tested_at  TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, channel_type, name)
);

CREATE INDEX idx_notif_channel_tenant ON notification_channel_configs(tenant_id);

-- =============================================================================
-- 15. Notification Log — Unified delivery outbox with retry tracking
-- =============================================================================

CREATE TABLE notification_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    channel_config_id UUID REFERENCES notification_channel_configs(id),
    source_type     TEXT NOT NULL,                            -- brief, alert, report
    source_id       UUID NOT NULL,                            -- FK to briefs.id, alerts.id, or generated_reports.id
    recipient_id    UUID NOT NULL REFERENCES stakeholders(id),
    channel         TEXT NOT NULL,                            -- email, slack, teams, webhook
    subject         TEXT,
    body_preview    TEXT,                                     -- first 500 chars for debugging
    status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'delivered', 'failed', 'bounced')),
    attempts        INT NOT NULL DEFAULT 0,
    max_attempts    INT NOT NULL DEFAULT 3,
    last_error      TEXT,
    queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    failed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_log_tenant ON notification_log(tenant_id);
CREATE INDEX idx_notif_log_status ON notification_log(status);
CREATE INDEX idx_notif_log_source ON notification_log(source_type, source_id);
CREATE INDEX idx_notif_log_recipient ON notification_log(recipient_id);
CREATE INDEX idx_notif_log_queued ON notification_log(queued_at) WHERE status = 'queued';

-- =============================================================================
-- 16. Data Snapshots — Time-series metric snapshots for trends and predictive risk
-- =============================================================================

CREATE TABLE data_snapshots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    domain          TEXT NOT NULL CHECK (domain IN ('it_assets', 'saas', 'compliance', 'contracts', 'identity', 'overall')),
    metric_name     TEXT NOT NULL,                            -- e.g. compliance_score, unused_licenses, asset_drift_count
    metric_value    NUMERIC(14, 4) NOT NULL,
    dimensions      JSONB NOT NULL DEFAULT '{}',              -- optional grouping: {framework: "SOC 2"}, {app: "Slack"}
    snapshot_date   DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_snapshots_tenant_domain ON data_snapshots(tenant_id, domain);
CREATE INDEX idx_snapshots_metric ON data_snapshots(metric_name, snapshot_date DESC);
CREATE INDEX idx_snapshots_date ON data_snapshots(snapshot_date DESC);
-- Prevent duplicate snapshots for the same metric on the same day with same dimensions
CREATE UNIQUE INDEX idx_snapshots_unique ON data_snapshots(tenant_id, domain, metric_name, snapshot_date, md5(dimensions::text));

-- =============================================================================
-- 17. Scheduled Jobs — Orchestrate recurring tasks (brief generation, syncs, reports)
-- =============================================================================

CREATE TABLE scheduled_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    job_type        TEXT NOT NULL,                            -- sync_domain, generate_briefs, generate_report, compute_predictions, capture_snapshot
    schedule_cron   TEXT NOT NULL,                            -- cron expression, e.g. "0 8 * * *" for 8 AM daily
    timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    config          JSONB NOT NULL DEFAULT '{}',              -- job-specific params: {domain: "it_assets"}, {role_id: "..."}
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_run_at     TIMESTAMPTZ,
    last_status     TEXT CHECK (last_status IN ('success', 'partial', 'failed')),
    next_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_tenant ON scheduled_jobs(tenant_id);
CREATE INDEX idx_jobs_next_run ON scheduled_jobs(next_run_at) WHERE is_active = true;

-- =============================================================================
-- 18. Signal Comments — Stakeholder collaboration and annotation on signals
-- =============================================================================

CREATE TABLE signal_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    signal_id       UUID NOT NULL REFERENCES signals(id),
    stakeholder_id  UUID NOT NULL REFERENCES stakeholders(id),
    comment_text    TEXT NOT NULL,
    is_internal     BOOLEAN NOT NULL DEFAULT false,           -- internal notes vs. shared comments
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signal_comments_signal ON signal_comments(signal_id);
CREATE INDEX idx_signal_comments_tenant ON signal_comments(tenant_id);

-- =============================================================================
-- 19. SaaS License Assignments — Per-user license tracking for waste detection
-- =============================================================================

CREATE TABLE saas_license_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    saas_app_id     UUID NOT NULL REFERENCES saas_applications(id),
    identity_id     UUID REFERENCES identities(id),           -- NULL if user not yet matched
    external_id     TEXT NOT NULL,                             -- AssetZentri assignment ID
    user_email      TEXT NOT NULL,
    license_type    TEXT,                                      -- e.g. basic, pro, enterprise
    assigned_at     DATE,
    last_active_at  TIMESTAMPTZ,                              -- last usage timestamp
    is_active       BOOLEAN NOT NULL DEFAULT true,
    monthly_cost    NUMERIC(10, 2),                           -- per-seat cost
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_id)
);

CREATE INDEX idx_license_assign_tenant ON saas_license_assignments(tenant_id);
CREATE INDEX idx_license_assign_app ON saas_license_assignments(saas_app_id);
CREATE INDEX idx_license_assign_identity ON saas_license_assignments(identity_id);
CREATE INDEX idx_license_assign_inactive ON saas_license_assignments(last_active_at) WHERE is_active = true;

-- =============================================================================
-- Apply updated_at triggers to new mutable tables
-- =============================================================================

DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'notification_channel_configs',
            'scheduled_jobs',
            'signal_comments',
            'saas_license_assignments'
        ])
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
            tbl, tbl
        );
    END LOOP;
END;
$$;

COMMIT;
