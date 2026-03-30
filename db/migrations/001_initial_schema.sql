-- ZentriPulse Database Schema
-- AssetZentri's Proactive Intelligence Layer
-- 13 Table Groups, 22 Tables
--
-- Key Design Principles:
--   1. external_id on every domain table links back to AssetZentri — ZentriPulse never owns source data
--   2. raw_data JSONB captures full API payloads so new AssetZentri fields are available without migrations
--   3. tenant_id on every table with MSP parent-child hierarchy
--   4. Detection (fusion_rules) → Routing (signal_routing_rules) → Delivery (briefs/alerts) are cleanly separated layers

BEGIN;

-- =============================================================================
-- 1. Multi-Tenancy — MSP-ready org hierarchy with role-based signal preferences
-- =============================================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    parent_id       UUID REFERENCES tenants(id),          -- MSP parent-child hierarchy
    settings        JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE stakeholder_roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,                         -- e.g. CISO, IT Manager, CFO, Compliance Officer, Procurement, CIO
    signal_preferences JSONB NOT NULL DEFAULT '{}',       -- which signal types/severities this role cares about
    brief_template_id UUID,                               -- default brief template for this role (FK added after brief_templates)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, name)
);

CREATE TABLE stakeholders (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    role_id         UUID NOT NULL REFERENCES stakeholder_roles(id),
    external_id     TEXT,                                  -- links back to AssetZentri user
    name            TEXT NOT NULL,
    email           TEXT NOT NULL,
    notification_channels JSONB NOT NULL DEFAULT '["email"]', -- email, slack, teams, webhook
    timezone        TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stakeholders_tenant ON stakeholders(tenant_id);
CREATE INDEX idx_stakeholders_role ON stakeholders(role_id);

-- =============================================================================
-- 2. API Integration — Connect to each AssetZentri domain (5 APIs), track sync health
-- =============================================================================

CREATE TABLE api_connections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    domain          TEXT NOT NULL CHECK (domain IN ('it_assets', 'saas', 'compliance', 'contracts', 'identity')),
    base_url        TEXT NOT NULL,
    auth_config     JSONB NOT NULL DEFAULT '{}',           -- encrypted credentials reference
    sync_interval_minutes INT NOT NULL DEFAULT 60,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_sync_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, domain)
);

CREATE TABLE sync_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    connection_id   UUID NOT NULL REFERENCES api_connections(id),
    domain          TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('started', 'success', 'partial', 'failed')),
    records_fetched INT DEFAULT 0,
    records_upserted INT DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_logs_connection ON sync_logs(connection_id);
CREATE INDEX idx_sync_logs_tenant_domain ON sync_logs(tenant_id, domain);

-- =============================================================================
-- 3. IT Assets — Endpoints, servers, mTLS trust status, warranty tracking
-- =============================================================================

CREATE TABLE assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    external_id     TEXT NOT NULL,                         -- AssetZentri asset ID
    asset_type      TEXT NOT NULL,                         -- endpoint, server, network_device, etc.
    hostname        TEXT,
    serial_number   TEXT,
    os              TEXT,
    os_version      TEXT,
    mtls_trust_status TEXT CHECK (mtls_trust_status IN ('trusted', 'untrusted', 'unknown', 'expired')),
    warranty_expiry DATE,
    last_seen_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active',
    tags            JSONB NOT NULL DEFAULT '[]',
    raw_data        JSONB,                                 -- full AssetZentri API payload
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_id)
);

CREATE INDEX idx_assets_tenant ON assets(tenant_id);
CREATE INDEX idx_assets_type ON assets(asset_type);
CREATE INDEX idx_assets_warranty ON assets(warranty_expiry);

-- =============================================================================
-- 4. SaaS Governance — License usage, costs, duplicates, shadow IT detection
-- =============================================================================

CREATE TABLE saas_applications (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    external_id     TEXT NOT NULL,                         -- AssetZentri SaaS app ID
    name            TEXT NOT NULL,
    vendor          TEXT,
    category        TEXT,
    total_licenses  INT,
    used_licenses   INT,
    monthly_cost    NUMERIC(12, 2),
    is_sanctioned   BOOLEAN NOT NULL DEFAULT true,         -- false = shadow IT
    duplicate_of    UUID REFERENCES saas_applications(id), -- detected duplicate
    last_usage_at   TIMESTAMPTZ,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_id)
);

CREATE INDEX idx_saas_tenant ON saas_applications(tenant_id);
CREATE INDEX idx_saas_sanctioned ON saas_applications(is_sanctioned);

-- =============================================================================
-- 5. Compliance — Framework scores, control status, filing deadlines
-- =============================================================================

CREATE TABLE compliance_frameworks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    external_id     TEXT NOT NULL,
    name            TEXT NOT NULL,                         -- e.g. SOC 2, SEBI-CSCRF, ISO 27001
    version         TEXT,
    overall_score   NUMERIC(5, 2),                         -- 0-100
    total_controls  INT NOT NULL DEFAULT 0,
    passing_controls INT NOT NULL DEFAULT 0,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_id)
);

CREATE TABLE compliance_controls (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    framework_id    UUID NOT NULL REFERENCES compliance_frameworks(id),
    external_id     TEXT NOT NULL,
    control_ref     TEXT NOT NULL,                         -- e.g. CC6.1, A.8.1
    title           TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('passing', 'failing', 'not_assessed', 'not_applicable')),
    severity        TEXT CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    evidence_links  JSONB NOT NULL DEFAULT '[]',
    linked_asset_ids JSONB NOT NULL DEFAULT '[]',          -- cross-module traceability
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_id)
);

CREATE TABLE compliance_deadlines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    framework_id    UUID NOT NULL REFERENCES compliance_frameworks(id),
    title           TEXT NOT NULL,                         -- e.g. "SEBI-CSCRF Annual Filing"
    deadline_date   DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'at_risk', 'overdue', 'completed')),
    responsible_stakeholder_id UUID REFERENCES stakeholders(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_deadlines_date ON compliance_deadlines(deadline_date);
CREATE INDEX idx_compliance_controls_framework ON compliance_controls(framework_id);

-- =============================================================================
-- 6. Contracts — Vendor agreements, renewals, T&C risk flags, data residency conflicts
-- =============================================================================

CREATE TABLE contracts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    external_id     TEXT NOT NULL,
    vendor          TEXT NOT NULL,
    title           TEXT NOT NULL,
    contract_type   TEXT,                                  -- subscription, perpetual, service_agreement
    start_date      DATE,
    end_date        DATE,
    auto_renew      BOOLEAN DEFAULT false,
    annual_value    NUMERIC(14, 2),
    currency        TEXT DEFAULT 'INR',
    tc_risk_flags   JSONB NOT NULL DEFAULT '[]',           -- T&C risk items
    data_residency  TEXT,                                  -- data residency location
    linked_saas_ids JSONB NOT NULL DEFAULT '[]',           -- cross-reference to saas_applications
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')),
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_id)
);

CREATE INDEX idx_contracts_tenant ON contracts(tenant_id);
CREATE INDEX idx_contracts_end_date ON contracts(end_date);

-- =============================================================================
-- 7. Identity — Users, JIT access, SoD conflicts, MFA, risk scores
-- =============================================================================

CREATE TABLE identities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    external_id     TEXT NOT NULL,
    email           TEXT NOT NULL,
    display_name    TEXT,
    department      TEXT,
    role            TEXT,
    mfa_enabled     BOOLEAN DEFAULT false,
    jit_access_active BOOLEAN DEFAULT false,
    sod_conflicts   JSONB NOT NULL DEFAULT '[]',           -- separation of duty violations
    risk_score      NUMERIC(5, 2) DEFAULT 0,               -- 0-100
    last_login_at   TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'deprovisioned')),
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, external_id)
);

CREATE INDEX idx_identities_tenant ON identities(tenant_id);
CREATE INDEX idx_identities_risk ON identities(risk_score DESC);

-- =============================================================================
-- 8. Fusion Engine — Cross-domain detection rules and generated intelligence signals
-- =============================================================================

CREATE TABLE fusion_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    description     TEXT,
    domains         JSONB NOT NULL DEFAULT '[]',           -- which domains this rule spans, e.g. ["it_assets", "identity"]
    condition_logic JSONB NOT NULL,                        -- rule definition: thresholds, correlations
    severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    cooldown_minutes INT DEFAULT 60,                       -- suppress duplicate signals
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    rule_id         UUID REFERENCES fusion_rules(id),
    signal_type     TEXT NOT NULL,                         -- anomaly, threshold_breach, correlation, prediction
    title           TEXT NOT NULL,
    description     TEXT,
    severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    domains         JSONB NOT NULL DEFAULT '[]',           -- domains involved
    source_entities JSONB NOT NULL DEFAULT '[]',           -- references to assets, identities, etc.
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
    resolved_at     TIMESTAMPTZ,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_signals_tenant ON signals(tenant_id);
CREATE INDEX idx_signals_severity ON signals(severity);
CREATE INDEX idx_signals_status ON signals(status);
CREATE INDEX idx_signals_created ON signals(created_at DESC);

-- =============================================================================
-- 9. Signal Routing — Maps signals to roles by type, severity, and delivery mode
-- =============================================================================

CREATE TABLE signal_routing_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    role_id         UUID NOT NULL REFERENCES stakeholder_roles(id),
    signal_type     TEXT,                                  -- NULL = all types
    min_severity    TEXT NOT NULL DEFAULT 'low' CHECK (min_severity IN ('critical', 'high', 'medium', 'low', 'info')),
    domains         JSONB NOT NULL DEFAULT '[]',           -- filter by domain, empty = all
    delivery_mode   TEXT NOT NULL DEFAULT 'brief' CHECK (delivery_mode IN ('realtime', 'brief', 'digest', 'silent')),
    channel         TEXT NOT NULL DEFAULT 'email',         -- email, slack, teams, webhook, in_app
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_routing_tenant_role ON signal_routing_rules(tenant_id, role_id);

-- =============================================================================
-- 10. Claw Brief — Daily stakeholder briefings with delivery/read tracking
-- =============================================================================

CREATE TABLE brief_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    role_id         UUID REFERENCES stakeholder_roles(id),
    sections        JSONB NOT NULL DEFAULT '[]',           -- ordered list of brief sections
    format          TEXT NOT NULL DEFAULT 'html' CHECK (format IN ('html', 'markdown', 'pdf')),
    is_default      BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK from stakeholder_roles to brief_templates now that the table exists
ALTER TABLE stakeholder_roles
    ADD CONSTRAINT fk_stakeholder_roles_brief_template
    FOREIGN KEY (brief_template_id) REFERENCES brief_templates(id);

CREATE TABLE briefs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    stakeholder_id  UUID NOT NULL REFERENCES stakeholders(id),
    template_id     UUID REFERENCES brief_templates(id),
    brief_date      DATE NOT NULL,
    title           TEXT NOT NULL,
    content         JSONB NOT NULL,                        -- structured brief content
    signal_ids      JSONB NOT NULL DEFAULT '[]',           -- signals included in this brief
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    delivery_channel TEXT NOT NULL DEFAULT 'email',
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'read', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, stakeholder_id, brief_date)
);

CREATE INDEX idx_briefs_tenant_date ON briefs(tenant_id, brief_date DESC);
CREATE INDEX idx_briefs_stakeholder ON briefs(stakeholder_id);

-- =============================================================================
-- 11. Alerts & NL Query — Real-time alerts + natural language query log with reasoning traces
-- =============================================================================

CREATE TABLE alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    signal_id       UUID NOT NULL REFERENCES signals(id),
    stakeholder_id  UUID NOT NULL REFERENCES stakeholders(id),
    channel         TEXT NOT NULL,                         -- email, slack, teams, webhook
    title           TEXT NOT NULL,
    body            TEXT,
    priority        TEXT NOT NULL CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
    delivered_at    TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'acknowledged', 'failed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_tenant ON alerts(tenant_id);
CREATE INDEX idx_alerts_stakeholder ON alerts(stakeholder_id);
CREATE INDEX idx_alerts_status ON alerts(status);

CREATE TABLE nl_queries (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    stakeholder_id  UUID NOT NULL REFERENCES stakeholders(id),
    query_text      TEXT NOT NULL,                         -- natural language question
    reasoning_trace JSONB,                                 -- step-by-step AI reasoning
    generated_sql   TEXT,                                  -- SQL generated (if applicable)
    result_summary  TEXT,                                  -- human-readable answer
    domains_queried JSONB NOT NULL DEFAULT '[]',
    response_time_ms INT,
    feedback        TEXT CHECK (feedback IN ('helpful', 'not_helpful', NULL)),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nl_queries_tenant ON nl_queries(tenant_id);
CREATE INDEX idx_nl_queries_stakeholder ON nl_queries(stakeholder_id);

-- =============================================================================
-- 12. Auto Reports — SEBI-CSCRF, SOC 2, board packs with review/approval workflow
-- =============================================================================

CREATE TABLE report_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,                         -- e.g. "SEBI-CSCRF Annual Report", "SOC 2 Type II Narrative"
    report_type     TEXT NOT NULL,                         -- compliance_audit, board_pack, executive_summary
    framework_id    UUID REFERENCES compliance_frameworks(id),
    sections        JSONB NOT NULL DEFAULT '[]',
    output_format   TEXT NOT NULL DEFAULT 'pdf' CHECK (output_format IN ('pdf', 'docx', 'html')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE generated_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    template_id     UUID NOT NULL REFERENCES report_templates(id),
    title           TEXT NOT NULL,
    report_period_start DATE,
    report_period_end DATE,
    content         JSONB NOT NULL,                        -- auto-generated narrative sections
    file_url        TEXT,                                  -- stored report file
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'archived')),
    generated_by    TEXT NOT NULL DEFAULT 'system',        -- system or stakeholder id
    reviewed_by     UUID REFERENCES stakeholders(id),
    approved_by     UUID REFERENCES stakeholders(id),
    approved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reports_tenant ON generated_reports(tenant_id);
CREATE INDEX idx_reports_status ON generated_reports(status);

-- =============================================================================
-- 13. Actions & Audit — Kill Switch actions via AssetZentri API, predictive risk, full audit trail
-- =============================================================================

CREATE TABLE kill_switch_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    signal_id       UUID REFERENCES signals(id),           -- signal that triggered the action
    action_type     TEXT NOT NULL,                          -- disable_user, isolate_device, revoke_access, block_app
    target_type     TEXT NOT NULL,                          -- asset, identity, saas_application
    target_id       TEXT NOT NULL,                          -- external_id of the target entity
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'executed', 'failed', 'rolled_back')),
    approved_by     UUID REFERENCES stakeholders(id),
    executed_at     TIMESTAMPTZ,
    rollback_at     TIMESTAMPTZ,
    api_response    JSONB,                                 -- AssetZentri API response
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE risk_predictions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    prediction_type TEXT NOT NULL,                          -- license_waste, compliance_gap, contract_lapse, security_drift
    entity_type     TEXT NOT NULL,                          -- asset, saas_application, contract, identity, compliance_control
    entity_id       UUID,
    predicted_date  DATE,                                   -- when the risk is predicted to materialize
    confidence      NUMERIC(5, 2) NOT NULL,                 -- 0-100
    description     TEXT NOT NULL,
    recommended_action TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'mitigated', 'materialized', 'dismissed')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_predictions_tenant ON risk_predictions(tenant_id);
CREATE INDEX idx_predictions_date ON risk_predictions(predicted_date);

CREATE TABLE audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    actor_type      TEXT NOT NULL,                          -- stakeholder, system, api
    actor_id        TEXT,
    action          TEXT NOT NULL,                          -- e.g. signal.created, brief.delivered, kill_switch.executed
    resource_type   TEXT NOT NULL,                          -- table name
    resource_id     UUID,
    changes         JSONB,                                  -- before/after snapshot
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_action ON audit_log(action);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX idx_audit_resource ON audit_log(resource_type, resource_id);

-- =============================================================================
-- Updated-at trigger function (reusable)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all mutable tables
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT unnest(ARRAY[
            'tenants', 'stakeholder_roles', 'stakeholders',
            'api_connections', 'assets', 'saas_applications',
            'compliance_frameworks', 'compliance_controls', 'compliance_deadlines',
            'contracts', 'identities',
            'fusion_rules', 'signals', 'signal_routing_rules',
            'brief_templates', 'briefs', 'alerts',
            'report_templates', 'generated_reports',
            'kill_switch_actions', 'risk_predictions'
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
