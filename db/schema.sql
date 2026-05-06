-- GraveRescue database schema
-- PostgreSQL 16 + PostGIS 3.x
-- Run: psql -U postgres -d graverescue -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- CEMETERIES — point locations: all cemetery types
-- =============================================================================
CREATE TYPE cemetery_type AS ENUM (
    'family_private',
    'church_community',
    'african_american',
    'native_american',
    'institutional',
    'military_veterans',
    'religious',
    'mass_burial',
    'unknown_other'
);

CREATE TYPE rescue_status AS ENUM (
    'maintained',
    'neglected',
    'overgrown',
    'lost',
    'reclaimed',
    'disinterred'
);

CREATE TABLE cemeteries (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name             TEXT NOT NULL,
    cemetery_type    cemetery_type NOT NULL,
    rescue_status    rescue_status NOT NULL,
    geom             GEOMETRY(Point, 4326) NOT NULL,
    established_year INTEGER,
    last_known_year  INTEGER,
    stone_count      INTEGER,
    address          TEXT,
    city             TEXT,
    state_province   TEXT,
    country          TEXT NOT NULL DEFAULT 'US',
    description      TEXT,
    names_inscriptions TEXT,
    wikipedia_url    TEXT,
    external_refs    JSONB DEFAULT '{}'::jsonb,
    -- Moderation
    verified         BOOLEAN DEFAULT false,
    mod_status       VARCHAR(20) NOT NULL DEFAULT 'pending',
    mod_note         TEXT,
    submitted_by     UUID,
    photo_url        TEXT,
    -- Meta
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_cemeteries_geom   ON cemeteries USING GIST(geom);
CREATE INDEX idx_cemeteries_type   ON cemeteries(cemetery_type);
CREATE INDEX idx_cemeteries_status ON cemeteries(rescue_status);
CREATE INDEX idx_cemeteries_state  ON cemeteries(country, state_province);

-- =============================================================================
-- PHOTOS — images attached to cemeteries
-- =============================================================================
CREATE TABLE photos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cemetery_id     UUID REFERENCES cemeteries(id) ON DELETE CASCADE,
    url             TEXT NOT NULL,
    thumbnail_url   TEXT,
    caption         TEXT,
    photographer    TEXT,
    taken_year      INTEGER,
    is_historic     BOOLEAN DEFAULT false,
    license         TEXT,
    source_url      TEXT,
    uploaded_by     UUID,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_photos_cemetery ON photos(cemetery_id);

-- =============================================================================
-- CEMETERY_PHOTOS — upload-linked photos (full + thumb from R2)
-- =============================================================================
CREATE TABLE cemetery_photos (
    id          SERIAL PRIMARY KEY,
    cemetery_id UUID NOT NULL REFERENCES cemeteries(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    thumb_url   TEXT,
    sort_order  INT  NOT NULL DEFAULT 0
);
CREATE INDEX idx_cemetery_photos_cemetery ON cemetery_photos(cemetery_id);

-- =============================================================================
-- SOURCES — citations
-- =============================================================================
CREATE TABLE sources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cemetery_id     UUID REFERENCES cemeteries(id) ON DELETE CASCADE,
    kind            TEXT,
    citation        TEXT NOT NULL,
    url             TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sources_cemetery ON sources(cemetery_id);

-- =============================================================================
-- USERS — contributors
-- =============================================================================
CREATE TABLE users (
    id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email                           VARCHAR(255) UNIQUE NOT NULL,
    display_name                    TEXT,
    password_hash                   TEXT,
    role                            VARCHAR(20) NOT NULL DEFAULT 'contributor',
    bio                             TEXT,
    verified                        BOOLEAN NOT NULL DEFAULT false,
    verification_token              TEXT,
    verification_token_expires_at   TIMESTAMPTZ,
    email_send_failed               BOOLEAN NOT NULL DEFAULT false,
    email_send_error                TEXT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at                    TIMESTAMPTZ
);
CREATE INDEX idx_users_email ON users(email);

-- =============================================================================
-- PASSWORD_RESET_TOKENS
-- =============================================================================
CREATE TABLE password_reset_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token      TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used       BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EDITS — audit log
-- =============================================================================
CREATE TABLE edits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    user_id         UUID REFERENCES users(id),
    action          TEXT NOT NULL,
    diff            JSONB,
    status          TEXT NOT NULL DEFAULT 'approved',
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_edits_entity ON edits(entity_type, entity_id);
CREATE INDEX idx_edits_status ON edits(status);
CREATE INDEX idx_edits_user   ON edits(user_id);

-- =============================================================================
-- FEEDBACK
-- =============================================================================
CREATE TYPE feedback_type AS ENUM ('suggestion', 'bug_report', 'cemetery_correction', 'other');
CREATE TYPE feedback_status AS ENUM ('new', 'in_progress', 'resolved', 'dismissed');

CREATE TABLE feedback (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type              feedback_type NOT NULL,
    subject           TEXT NOT NULL,
    description       TEXT NOT NULL,
    submitter_name    TEXT,
    submitter_email   TEXT,
    submitter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status            feedback_status NOT NULL DEFAULT 'new',
    admin_notes       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Convenience view: cemeteries as GeoJSON-ready rows
-- =============================================================================
CREATE OR REPLACE VIEW cemeteries_geojson AS
SELECT
    c.id,
    c.name,
    c.cemetery_type,
    c.rescue_status,
    c.established_year,
    c.last_known_year,
    c.stone_count,
    c.city,
    c.state_province,
    c.country,
    c.description,
    c.photo_url,
    c.submitted_by,
    ST_Y(c.geom) AS lat,
    ST_X(c.geom) AS lng,
    (SELECT COUNT(*) FROM photos p WHERE p.cemetery_id = c.id) AS photo_count
FROM cemeteries c
WHERE c.mod_status = 'approved';
