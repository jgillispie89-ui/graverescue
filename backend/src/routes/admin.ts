import { Router } from 'express';
import crypto from 'crypto';
import { pool } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendPasswordResetEmail } from '../email.js';

const router = Router();

router.get('/queue', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT c.id, c.name, c.cemetery_type, c.rescue_status, c.mod_status,
                   c.city, c.state_province, c.established_year, c.last_known_year,
                   c.description, ST_AsGeoJSON(c.geom)::json AS geometry,
                   u.email AS submitted_by, c.created_at, c.mod_note
            FROM cemeteries c
            LEFT JOIN users u ON u.id = c.submitted_by
            WHERE c.mod_status = 'pending'
            ORDER BY c.created_at DESC
        `);
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/approve/:id', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE cemeteries SET mod_status = 'approved', mod_note = $2 WHERE id = $1 RETURNING id, name`,
            [req.params.id, req.body.note || null]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true, cemetery: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/reject/:id', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `UPDATE cemeteries SET mod_status = 'rejected', mod_note = $2 WHERE id = $1 RETURNING id, name`,
            [req.params.id, req.body.note || null]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true, cemetery: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/unverified-users', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT id, email, verified, email_send_failed, email_send_error, created_at
            FROM users
            WHERE verified = false
            ORDER BY created_at DESC
        `);
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/verify-user', requireAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        const { rows } = await pool.query(
            `UPDATE users
             SET verified = true,
                 verification_token = NULL,
                 verification_token_expires_at = NULL,
                 email_send_failed = false,
                 email_send_error = NULL
             WHERE LOWER(email) = LOWER($1)
             RETURNING id, email, role`,
            [email]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });
        res.json({ ok: true, user: rows[0] });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/feedback/new-count', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM feedback WHERE status = 'new'`);
        res.json({ count: parseInt(rows[0].count, 10) });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/feedback', requireAdmin, async (req, res) => {
    try {
        const showAll = req.query.show_all === '1';
        const { rows } = await pool.query(
            showAll
                ? `SELECT * FROM feedback ORDER BY created_at DESC`
                : `SELECT * FROM feedback WHERE status NOT IN ('resolved','dismissed') ORDER BY created_at DESC`
        );
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.patch('/feedback/:id', requireAdmin, async (req, res) => {
    try {
        const sets: string[] = ['updated_at = NOW()'];
        const params: any[]  = [];
        let i = 1;
        if (req.body.status      !== undefined) { sets.push(`status      = $${i++}`); params.push(req.body.status); }
        if (req.body.admin_notes !== undefined) { sets.push(`admin_notes = $${i++}`); params.push(req.body.admin_notes || null); }
        params.push(req.params.id);
        const { rows } = await pool.query(
            `UPDATE feedback SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
            params
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json(rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/feedback/:id', requireAdmin, async (req, res) => {
    try {
        const { rows } = await pool.query(
            `DELETE FROM feedback WHERE id = $1 RETURNING id`, [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Not found' });
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/send-password-reset', requireAdmin, async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });

        const { rows } = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]
        );
        if (!rows.length) return res.status(404).json({ error: 'User not found' });

        const userId  = rows[0].id;
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000);
        await pool.query(
            `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
            [userId, token, expires]
        );

        await sendPasswordResetEmail(email.toLowerCase(), token);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// TODO: Daily digest email — send admin a summary of pending counts
// (new headstones + pending edits + pending cemeteries + new feedback)
// Build the cron/scheduler when email delivery is confirmed working.

// Headstone queue
router.get('/headstones/queue', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT h.*, c.name AS cemetery_name, u.email AS submitter_email
            FROM headstones h
            LEFT JOIN cemeteries c ON c.id = h.cemetery_id
            LEFT JOIN users u ON u.id = h.submitted_by
            WHERE h.mod_status = 'pending'
            ORDER BY h.created_at ASC
        `);
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/headstones/queue-count', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`SELECT COUNT(*) FROM headstones WHERE mod_status='pending'`);
        res.json({ count: parseInt(rows[0].count) });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/headstones/approve/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query(`UPDATE headstones SET mod_status='approved' WHERE id=$1`, [req.params.id]);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/headstones/reject/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query(`UPDATE headstones SET mod_status='rejected' WHERE id=$1`, [req.params.id]);
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// Headstone edit proposals
router.get('/headstone-edits/queue', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`
            SELECT e.*,
                   h.name AS current_name, h.birth_year AS current_birth_year,
                   h.birth_month AS current_birth_month, h.birth_day AS current_birth_day,
                   h.birth_place AS current_birth_place,
                   h.death_year AS current_death_year, h.death_month AS current_death_month,
                   h.death_day AS current_death_day, h.death_place AS current_death_place,
                   h.inscription AS current_inscription, h.relationship AS current_relationship,
                   h.condition AS current_condition, h.photo_url AS current_photo_url,
                   h.cemetery_id,
                   c.name AS cemetery_name,
                   u.email AS proposer_email
            FROM headstone_edits e
            JOIN headstones h ON h.id = e.headstone_id
            LEFT JOIN cemeteries c ON c.id = h.cemetery_id
            LEFT JOIN users u ON u.id = e.proposed_by
            WHERE e.status = 'pending'
            ORDER BY e.created_at ASC
        `);
        res.json(rows);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
router.get('/headstone-edits/queue-count', requireAdmin, async (_req, res) => {
    try {
        const { rows } = await pool.query(`SELECT COUNT(*) FROM headstone_edits WHERE status='pending'`);
        res.json({ count: parseInt(rows[0].count) });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/headstone-edits/approve/:id', requireAdmin, async (req: any, res) => {
    try {
        const { rows: editRows } = await pool.query(`SELECT * FROM headstone_edits WHERE id=$1`, [req.params.id]);
        if (!editRows.length) return res.status(404).json({ error: 'Not found' });
        const edit = editRows[0];
        const data = edit.proposed_data as any;
        await pool.query(
            `UPDATE headstones SET
                name=COALESCE($1,name), birth_year=$2, birth_month=$3, birth_day=$4, birth_place=$5,
                death_year=$6, death_month=$7, death_day=$8, death_place=$9,
                inscription=$10, relationship=$11, condition=$12, photo_url=$13,
                updated_at=NOW()
             WHERE id=$14`,
            [data.name||null, data.birth_year||null, data.birth_month||null, data.birth_day||null, data.birth_place||null,
             data.death_year||null, data.death_month||null, data.death_day||null, data.death_place||null,
             data.inscription||null, data.relationship||null, data.condition||null, data.photo_url||null,
             edit.headstone_id]
        );
        await pool.query(
            `UPDATE headstone_edits SET status='approved', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`,
            [req.user.id, req.params.id]
        );
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/headstone-edits/reject/:id', requireAdmin, async (req: any, res) => {
    try {
        await pool.query(
            `UPDATE headstone_edits SET status='rejected', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2`,
            [req.user.id, req.params.id]
        );
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
