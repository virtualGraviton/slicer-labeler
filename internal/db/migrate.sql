-- Models: top-level training model/project
CREATE TABLE IF NOT EXISTS models (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Datasets: belong to a model
CREATE TABLE IF NOT EXISTS datasets (
    id          BIGSERIAL PRIMARY KEY,
    model_id    BIGINT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_datasets_model_id ON datasets (model_id);

-- Entries: individual audio annotations, belong to a dataset
CREATE TABLE IF NOT EXISTS entries (
    id          BIGSERIAL PRIMARY KEY,
    dataset_id  BIGINT NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
    wav_path    TEXT NOT NULL,
    speaker     TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(dataset_id, wav_path)
);

CREATE INDEX IF NOT EXISTS idx_entries_dataset_id ON entries (dataset_id);
CREATE INDEX IF NOT EXISTS idx_entries_wav_path ON entries (wav_path);

-- Quality results: one-to-one with entries
CREATE TABLE IF NOT EXISTS quality_results (
    id          BIGSERIAL PRIMARY KEY,
    entry_id    BIGINT NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'pending',
    risk        TEXT NOT NULL DEFAULT 'low',
    checked_at  TIMESTAMPTZ,
    model       TEXT NOT NULL DEFAULT '',
    text_hash   TEXT NOT NULL DEFAULT '',
    summary     TEXT NOT NULL DEFAULT '',
    reasons     JSONB NOT NULL DEFAULT '[]',
    audio       JSONB NOT NULL DEFAULT '{}',
    text_risk   JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_results_risk ON quality_results (risk);
