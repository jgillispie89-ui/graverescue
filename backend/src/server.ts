import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { pool } from './db.js';
import authRouter from './routes/auth.js';
import adminRouter from './routes/admin.js';
import uploadRouter from './routes/upload.js';
import feedbackRouter from './routes/feedback.js';
import { requireAuth } from './middleware/auth.js';

dotenv.config();

const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
});

const app = express();
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',').map(o => o.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)) }));
app.use(express.json());

// =============================================================================
// DB migration — runs once on startup, idempotent
// =============================================================================
async function migrate() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email                           VARCHAR(255) UNIQUE NOT NULL,
            password_hash                   TEXT,
            role                            VARCHAR(20) NOT NULL DEFAULT 'contributor',
            verified                        BOOLEAN NOT NULL DEFAULT false,
            verification_token              TEXT,
            verification_token_expires_at   TIMESTAMPTZ,
            created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        ALTER TABLE users
            ADD COLUMN IF NOT EXISTS password_hash                  TEXT,
            ADD COLUMN IF NOT EXISTS role                           VARCHAR(20) NOT NULL DEFAULT 'contributor',
            ADD COLUMN IF NOT EXISTS verified                       BOOLEAN     NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS verification_token             TEXT,
            ADD COLUMN IF NOT EXISTS verification_token_expires_at  TIMESTAMPTZ,
            ADD COLUMN IF NOT EXISTS created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_send_failed BOOLEAN NOT NULL DEFAULT false`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_send_error TEXT`);

    // If old 16-value enum exists, drop it (and the dependent table) and recreate
    await pool.query(`
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_enum e
                JOIN pg_type t ON t.oid = e.enumtypid
                WHERE t.typname = 'cemetery_type' AND e.enumlabel = 'family_farm'
            ) THEN
                DROP TABLE IF EXISTS cemeteries CASCADE;
                DROP TYPE cemetery_type;
            END IF;
        END $$
    `);
    await pool.query(`
        DO $$ BEGIN
            CREATE TYPE cemetery_type AS ENUM (
                'family_private','church_community','african_american',
                'native_american','institutional','military_veterans',
                'religious','mass_burial','unknown_other'
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    `);

    await pool.query(`
        DO $$ BEGIN
            CREATE TYPE rescue_status AS ENUM (
                'maintained','neglected','overgrown','lost','reclaimed'
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS cemeteries (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name             TEXT NOT NULL,
            cemetery_type    cemetery_type NOT NULL DEFAULT 'unknown_other',
            rescue_status    rescue_status NOT NULL DEFAULT 'neglected',
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
            verified         BOOLEAN DEFAULT false,
            mod_status       VARCHAR(20) NOT NULL DEFAULT 'pending',
            mod_note         TEXT,
            submitted_by     UUID REFERENCES users(id),
            photo_url        TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cemeteries_geom   ON cemeteries USING GIST(geom)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cemeteries_type   ON cemeteries(cemetery_type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cemeteries_status ON cemeteries(rescue_status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_cemeteries_state  ON cemeteries(country, state_province)`);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS cemetery_photos (
            id          SERIAL PRIMARY KEY,
            cemetery_id UUID NOT NULL REFERENCES cemeteries(id) ON DELETE CASCADE,
            url         TEXT NOT NULL,
            thumb_url   TEXT,
            sort_order  INT  NOT NULL DEFAULT 0
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token      TEXT NOT NULL UNIQUE,
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        DO $$ BEGIN
            CREATE TYPE feedback_type AS ENUM ('suggestion', 'bug_report', 'cemetery_correction', 'other');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    `);
    await pool.query(`
        DO $$ BEGIN
            CREATE TYPE feedback_status AS ENUM ('new', 'in_progress', 'resolved', 'dismissed');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$
    `);
    await pool.query(`ALTER TYPE feedback_status ADD VALUE IF NOT EXISTS 'in_progress'`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS feedback (
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
        )
    `);
}

// =============================================================================
// Routes
// =============================================================================
app.use('/api/auth',     authRouter);
app.use('/api/admin',   adminRouter);
app.use('/api/upload',  uploadRouter);
app.use('/api/feedback', feedbackRouter);

app.get('/api/health', async (_req, res) => {
    try {
        const { rows } = await pool.query('SELECT postgis_version()');
        res.json({ ok: true, postgis: rows[0].postgis_version });
    } catch (err) {
        res.status(500).json({ ok: false, error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/cemeteries — public; only approved cemeteries visible
// =============================================================================
app.get('/api/cemeteries', async (req, res) => {
    try {
        const conditions: string[] = ["c.mod_status = 'approved'"];
        const params: any[] = [];
        let idx = 1;

        if (typeof req.query.bbox === 'string') {
            const parts = req.query.bbox.split(',').map(Number);
            if (parts.length === 4 && parts.every(n => Number.isFinite(n))) {
                const [minLng, minLat, maxLng, maxLat] = parts;
                conditions.push(`c.geom && ST_MakeEnvelope($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, 4326)`);
                params.push(minLng, minLat, maxLng, maxLat);
                idx += 4;
            }
        }
        if (typeof req.query.types === 'string') {
            const types = req.query.types.split(',');
            conditions.push(`c.cemetery_type = ANY($${idx}::cemetery_type[])`);
            params.push(types); idx++;
        }
        if (typeof req.query.statuses === 'string') {
            const statuses = req.query.statuses.split(',');
            conditions.push(`c.rescue_status = ANY($${idx}::rescue_status[])`);
            params.push(statuses); idx++;
        }
        if (typeof req.query.search === 'string') {
            const q = `%${req.query.search}%`;
            conditions.push(`(c.name ILIKE $${idx} OR c.city ILIKE $${idx} OR c.names_inscriptions ILIKE $${idx})`);
            params.push(q); idx++;
        }

        const sql = `
            SELECT c.id, c.name, c.cemetery_type, c.rescue_status,
                   c.established_year, c.last_known_year, c.stone_count,
                   c.city, c.state_province, c.country, c.description, c.photo_url,
                   c.submitted_by,
                   ST_AsGeoJSON(c.geom)::json AS geometry
            FROM cemeteries c
            WHERE ${conditions.join(' AND ')}
            LIMIT 5000
        `;
        const { rows } = await pool.query(sql, params);
        res.json({
            type: 'FeatureCollection',
            features: rows.map(r => ({
                type: 'Feature', geometry: r.geometry,
                properties: {
                    id: r.id, name: r.name,
                    cemetery_type: r.cemetery_type,
                    rescue_status: r.rescue_status,
                    established_year: r.established_year,
                    last_known_year: r.last_known_year,
                    stone_count: r.stone_count,
                    city: r.city, state: r.state_province, country: r.country,
                    description: r.description,
                    photo_url: r.photo_url, submitted_by: r.submitted_by,
                },
            })),
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// GET /api/cemeteries/:id
// =============================================================================
app.get('/api/cemeteries/:id', async (req, res) => {
    try {
        const { rows: cemRows } = await pool.query(
            `SELECT c.*, ST_AsGeoJSON(c.geom)::json AS geometry FROM cemeteries c WHERE c.id = $1`,
            [req.params.id]
        );
        if (!cemRows.length) return res.status(404).json({ error: 'Not found' });
        const cemetery = cemRows[0];
        const { rows: photos } = await pool.query(
            `SELECT * FROM photos WHERE cemetery_id = $1 ORDER BY taken_year NULLS LAST`, [req.params.id]
        );
        const { rows: cemPhotos } = await pool.query(
            `SELECT id, url, thumb_url, sort_order FROM cemetery_photos WHERE cemetery_id = $1 ORDER BY sort_order`,
            [req.params.id]
        );
        const { rows: sources } = await pool.query(
            `SELECT * FROM sources WHERE cemetery_id = $1`, [req.params.id]
        );
        res.json({ ...cemetery, photos, site_photos: cemPhotos, sources });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// POST /api/cemeteries — requires verified auth
// =============================================================================
app.post('/api/cemeteries', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        if (!user.verified)
            return res.status(403).json({ error: 'Verify your email before submitting cemeteries' });

        const { name, cemetery_type, rescue_status, lng, lat,
                established_year, last_known_year, stone_count,
                city, state_province, description, names_inscriptions,
                photo_url, photos } = req.body;

        if (!name || !cemetery_type || !rescue_status || lng == null || lat == null)
            return res.status(400).json({ error: 'name, cemetery_type, rescue_status, lng, lat are required' });

        const photoList: { url: string; thumb_url?: string }[] =
            Array.isArray(photos) && photos.length > 0
                ? photos.filter((p: any) => typeof p?.url === 'string')
                : photo_url ? [{ url: photo_url }] : [];
        const primaryPhotoUrl = photoList[0]?.url || null;

        const mod_status = (user.role === 'admin' || user.role === 'trusted') ? 'approved' : 'pending';
        const { rows } = await pool.query(
            `INSERT INTO cemeteries (name, cemetery_type, rescue_status, geom,
                established_year, last_known_year, stone_count,
                city, state_province, description, names_inscriptions,
                photo_url, mod_status, submitted_by)
             VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326),
                $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id, name, cemetery_type, rescue_status, mod_status`,
            [name, cemetery_type, rescue_status, lng, lat,
             established_year || null, last_known_year || null, stone_count || null,
             city || null, state_province || null, description || null,
             names_inscriptions || null, primaryPhotoUrl, mod_status, user.id]
        );

        if (photoList.length > 0) {
            await Promise.all(photoList.map((p, i) =>
                pool.query(
                    `INSERT INTO cemetery_photos (cemetery_id, url, thumb_url, sort_order) VALUES ($1, $2, $3, $4)`,
                    [rows[0].id, p.url, p.thumb_url || null, i]
                )
            ));
        }

        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// DELETE /api/cemeteries/:cemId/photos/:photoId
// =============================================================================
app.delete('/api/cemeteries/:cemId/photos/:photoId', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;

        const { rows: cemRows } = await pool.query(
            `SELECT submitted_by FROM cemeteries WHERE id = $1`, [req.params.cemId]
        );
        if (!cemRows.length) return res.status(404).json({ error: 'Cemetery not found' });
        if (user.role !== 'admin' && cemRows[0].submitted_by !== user.id)
            return res.status(403).json({ error: 'Not authorized' });

        const { rows: photoRows } = await pool.query(
            `SELECT id, url, thumb_url FROM cemetery_photos WHERE id = $1 AND cemetery_id = $2`,
            [req.params.photoId, req.params.cemId]
        );
        if (!photoRows.length) return res.status(404).json({ error: 'Photo not found' });

        const photo = photoRows[0];
        const base  = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');
        const toKey = (url: string) =>
            base && url.startsWith(base + '/') ? url.slice(base.length + 1) : null;

        const keys = [toKey(photo.url), photo.thumb_url ? toKey(photo.thumb_url) : null]
            .filter((k): k is string => Boolean(k));
        await Promise.all(keys.map(k =>
            s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: k }))
              .catch(() => {})
        ));

        await pool.query(`DELETE FROM cemetery_photos WHERE id = $1`, [photo.id]);
        await pool.query(
            `UPDATE cemeteries SET photo_url = NULL WHERE id = $1 AND photo_url = $2`,
            [req.params.cemId, photo.url]
        );

        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// PATCH /api/cemeteries/:id
// =============================================================================
app.patch('/api/cemeteries/:id', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        const { rows: existing } = await pool.query(
            `SELECT submitted_by FROM cemeteries WHERE id = $1`, [req.params.id]
        );
        if (!existing.length) return res.status(404).json({ error: 'Not found' });
        if (user.role !== 'admin' && existing[0].submitted_by !== user.id)
            return res.status(403).json({ error: 'Not authorized to edit this cemetery' });

        const { name, cemetery_type, rescue_status, lng, lat,
                established_year, last_known_year, stone_count,
                city, state_province, description, names_inscriptions, photos } = req.body;
        if (!name || !cemetery_type || !rescue_status)
            return res.status(400).json({ error: 'name, cemetery_type, and rescue_status are required' });

        const hasCoords = lng != null && lat != null && Number.isFinite(+lng) && Number.isFinite(+lat);
        const params: any[] = [
            name, cemetery_type, rescue_status,
            established_year || null, last_known_year || null, stone_count || null,
            city || null, state_province || null, description || null, names_inscriptions || null,
        ];
        if (hasCoords) { params.push(+lng, +lat); }
        params.push(req.params.id);
        const idIdx = params.length;

        const { rows } = await pool.query(
            `UPDATE cemeteries SET
                name=$1, cemetery_type=$2, rescue_status=$3,
                established_year=$4, last_known_year=$5, stone_count=$6,
                city=$7, state_province=$8, description=$9, names_inscriptions=$10,
                updated_at=NOW()
                ${hasCoords ? `, geom=ST_SetSRID(ST_MakePoint($11,$12),4326)` : ''}
             WHERE id=$${idIdx}
             RETURNING id, name, cemetery_type, rescue_status,
                       established_year, last_known_year, stone_count,
                       city, state_province, description, updated_at`,
            params
        );

        if (Array.isArray(photos) && photos.length > 0) {
            const { rows: ex } = await pool.query(
                `SELECT COALESCE(MAX(sort_order), -1) AS mx FROM cemetery_photos WHERE cemetery_id=$1`,
                [req.params.id]
            );
            const start = (ex[0]?.mx ?? -1) + 1;
            await Promise.all(
                photos.filter((p: any) => typeof p?.url === 'string').map((p: any, i: number) =>
                    pool.query(
                        `INSERT INTO cemetery_photos (cemetery_id, url, thumb_url, sort_order) VALUES ($1,$2,$3,$4)`,
                        [req.params.id, p.url, p.thumb_url || null, start + i]
                    )
                )
            );
        }

        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// DELETE /api/cemeteries/:id
// =============================================================================
app.delete('/api/cemeteries/:id', requireAuth, async (req, res) => {
    try {
        const user = (req as any).user;
        const { rows } = await pool.query(
            `DELETE FROM cemeteries WHERE id = $1 AND (submitted_by = $2 OR $3 = true) RETURNING id`,
            [req.params.id, user.id, user.role === 'admin']
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found or not authorized' });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: (err as Error).message });
    }
});

// =============================================================================
// Boot
// =============================================================================
const port = parseInt(process.env.PORT || '3001', 10);
migrate()
    .then(() => app.listen(port, () => console.log(`GraveRescue API listening on http://localhost:${port}`)))
    .catch(err => { console.error('Migration failed:', err); process.exit(1); });
