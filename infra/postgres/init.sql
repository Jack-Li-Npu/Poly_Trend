-- Poly Trend V2 bootstrap migration.
-- Durable production storage, PostgreSQL FTS, and pgvector retrieval.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS investigations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    query text NOT NULL CHECK (char_length(query) BETWEEN 4 AND 500),
    refresh_policy text NOT NULL DEFAULT 'manual'
        CHECK (refresh_policy IN ('manual', 'daily')),
    deep_mode boolean NOT NULL DEFAULT false,
    latest_run_id uuid,
    next_refresh_at timestamptz,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS research_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id uuid NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
    query text NOT NULL,
    status text NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    deep_mode boolean NOT NULL DEFAULT false,
    intent jsonb,
    answer jsonb,
    diff jsonb,
    error text,
    checkpoint_namespace text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE investigations
    DROP CONSTRAINT IF EXISTS investigations_latest_run_fk;
ALTER TABLE investigations
    ADD CONSTRAINT investigations_latest_run_fk
    FOREIGN KEY (latest_run_id) REFERENCES research_runs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS market_snapshots (
    id text NOT NULL,
    run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    event_id text,
    question text NOT NULL,
    description text NOT NULL DEFAULT '',
    slug text NOT NULL,
    tags text[] NOT NULL DEFAULT '{}',
    resolution_criteria text NOT NULL DEFAULT '',
    resolution_source text,
    probability double precision NOT NULL CHECK (probability BETWEEN 0 AND 1),
    best_bid double precision,
    best_ask double precision,
    spread double precision,
    volume_24h double precision NOT NULL DEFAULT 0,
    volume_total double precision NOT NULL DEFAULT 0,
    liquidity double precision NOT NULL DEFAULT 0,
    open_interest double precision NOT NULL DEFAULT 0,
    relevance double precision NOT NULL DEFAULT 0,
    relation_type text NOT NULL DEFAULT 'direct',
    relation_confidence double precision NOT NULL DEFAULT 0.5,
    included boolean NOT NULL DEFAULT true,
    quality double precision NOT NULL DEFAULT 0.5,
    freshness text NOT NULL DEFAULT 'unknown',
    history jsonb NOT NULL DEFAULT '[]'::jsonb,
    raw_provider_payload jsonb,
    embedding vector(384),
    search_document tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(question, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B') ||
        setweight(to_tsvector('english', coalesce(resolution_criteria, '')), 'C')
    ) STORED,
    observed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, id)
);

CREATE TABLE IF NOT EXISTS relationship_edges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    source_id text NOT NULL,
    target_id text NOT NULL,
    relation_type text NOT NULL CHECK (relation_type IN (
        'direct', 'duplicate', 'complement', 'supporting_proxy',
        'conflicting_proxy', 'measured_correlation', 'external_context'
    )),
    confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    explanation text NOT NULL,
    measured_correlation double precision,
    observation_count integer,
    UNIQUE (run_id, source_id, target_id, relation_type)
);

CREATE TABLE IF NOT EXISTS evidence_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    kind text NOT NULL,
    title text NOT NULL,
    source text NOT NULL,
    url text,
    published_at timestamptz,
    summary text NOT NULL DEFAULT '',
    supports_numeric_answer boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
    run_id uuid NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
    sequence integer NOT NULL,
    stage text NOT NULL,
    label text NOT NULL,
    status text NOT NULL DEFAULT 'completed',
    duration_ms integer,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS graph_checkpoints (
    thread_id text NOT NULL,
    checkpoint_id text NOT NULL,
    parent_checkpoint_id text,
    run_id uuid REFERENCES research_runs(id) ON DELETE CASCADE,
    state jsonb NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (thread_id, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS refresh_leases (
    investigation_id uuid PRIMARY KEY REFERENCES investigations(id) ON DELETE CASCADE,
    lease_owner text NOT NULL,
    lease_until timestamptz NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investigations_refresh_due_idx
    ON investigations (next_refresh_at)
    WHERE refresh_policy = 'daily' AND archived = false;
CREATE INDEX IF NOT EXISTS research_runs_investigation_created_idx
    ON research_runs (investigation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS market_snapshots_event_idx
    ON market_snapshots (event_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS market_snapshots_search_idx
    ON market_snapshots USING gin (search_document);
CREATE INDEX IF NOT EXISTS market_snapshots_embedding_hnsw_idx
    ON market_snapshots USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 96);
CREATE INDEX IF NOT EXISTS relationship_edges_run_idx
    ON relationship_edges (run_id);
CREATE INDEX IF NOT EXISTS run_events_run_sequence_idx
    ON run_events (run_id, sequence);

COMMENT ON COLUMN market_snapshots.embedding IS
    '384-dimensional BGE-small compatible embedding for local dense retrieval.';
COMMENT ON TABLE graph_checkpoints IS
    'Durable LangGraph checkpoint states used for replay and market-inclusion forks.';
