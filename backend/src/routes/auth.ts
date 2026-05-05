import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db.js';
import { signToken } from '../token.js';
import { sendVerificationEmail, sendAdminNotificationEmail, sendPasswordResetEmail } from '../email.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

// =============================================================================
// POST /api/auth/register
// =============================================================================
router.post('/register', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const hash        = await bcrypt.hash(password, 12);
        const vtoken      = crypto.randomBytes(32).toString('hex');
        const vexpiry     = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const role        = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'contributor';
        const displayName = email.split('@')[0];

        const { rows } = await pool.query(
            `INSERT INTO users (email, display_name, password_hash, role, verification_token, verification_token_expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, role`,
            [email.toLowerCase(), displayName, hash, role, vtoken, vexpiry]
        );
        const u = rows[0];

        // Fire-and-forget verification email with retry; track failure in DB if all attempts exhausted
        (async () => {
            try {
                await sendVerificationEmail(u.email, vtoken);
            } catch (err: any) {
                console.error('[register] Verification email failed after all retries — userId:', u.id, 'to:', u.email, 'error:', err.message);
                await pool.query(
                    'UPDATE users SET email_send_failed = true, email_send_error = $1 WHERE id = $2',
                    [String(err.message).slice(0, 500), u.id]
                ).catch(e => console.error('[register] Failed to record email failure in DB:', e.message));
            }
        })();

        // Admin notification — best-effort, no retry
        sendAdminNotificationEmail(u.email, u.id).catch(err =>
            console.error('Admin notification failed:', err.message)
        );

        const token = signToken({ id: u.id, email: u.email, role: u.role, verified: false });
        res.status(201).json({ token, user: { id: u.id, email: u.email, role: u.role, verified: false } });
    } catch (err: any) {
        if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/auth/login
// =============================================================================
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { rows } = await pool.query(
            'SELECT * FROM users WHERE email = $1', [email?.toLowerCase()]
        );
        const u = rows[0];
        if (!u || !u.password_hash || !(await bcrypt.compare(password, u.password_hash)))
            return res.status(401).json({ error: 'Invalid email or password' });

        const token = signToken({ id: u.id, email: u.email, role: u.role, verified: u.verified });
        res.json({ token, user: { id: u.id, email: u.email, role: u.role, verified: u.verified } });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// GET /api/auth/verify?token=XXX
// Returns a fresh JWT with verified: true on success
// =============================================================================
router.get('/verify', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Token required' });

        const { rows } = await pool.query(
            `UPDATE users
             SET verified = true, verification_token = NULL, verification_token_expires_at = NULL,
                 email_send_failed = false, email_send_error = NULL
             WHERE verification_token = $1
               AND verification_token_expires_at > NOW()
             RETURNING id, email, role`,
            [token]
        );
        if (!rows.length) return res.status(400).json({ error: 'Invalid or expired verification link' });

        const u = rows[0];
        const newToken = signToken({ id: u.id, email: u.email, role: u.role, verified: true });
        res.json({ ok: true, token: newToken });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/auth/resend-verification
// Throttled: one email per 5 minutes. Awaits send so user gets a real error if it fails.
// =============================================================================
router.post('/resend-verification', requireAuth, async (req, res) => {
    try {
        const { id } = (req as any).user;
        const { rows } = await pool.query(
            'SELECT email, verified, verification_token_expires_at FROM users WHERE id = $1', [id]
        );
        const u = rows[0];
        if (!u) return res.status(404).json({ error: 'User not found' });
        if (u.verified) return res.json({ ok: true, message: 'Already verified' });

        if (u.verification_token_expires_at) {
            const expiresAt  = new Date(u.verification_token_expires_at).getTime();
            const lastSentAt = expiresAt - 48 * 60 * 60 * 1000;
            const fiveMinsAgo = Date.now() - 5 * 60 * 1000;
            if (lastSentAt > fiveMinsAgo) {
                return res.status(429).json({ error: 'Please wait 5 minutes before requesting another verification email' });
            }
        }

        const vtoken  = crypto.randomBytes(32).toString('hex');
        const vexpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
        await pool.query(
            'UPDATE users SET verification_token = $1, verification_token_expires_at = $2 WHERE id = $3',
            [vtoken, vexpiry, id]
        );

        try {
            await sendVerificationEmail(u.email, vtoken);
            await pool.query(
                'UPDATE users SET email_send_failed = false, email_send_error = NULL WHERE id = $1', [id]
            );
            res.json({ ok: true });
        } catch (err: any) {
            console.error('[resend] Verification email failed — userId:', id, 'to:', u.email, 'error:', err.message);
            await pool.query(
                'UPDATE users SET email_send_failed = true, email_send_error = $1 WHERE id = $2',
                [String(err.message).slice(0, 500), id]
            ).catch(e => console.error('[resend] Failed to record email failure:', e.message));
            return res.status(500).json({ error: 'Failed to send verification email — please try again in a few minutes.' });
        }
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/auth/forgot-password
// Always returns the same success message — never reveals whether email exists.
// Rate limit: max 3 tokens per email per hour (silently skipped when exceeded).
// =============================================================================
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });

        const { rows } = await pool.query(
            'SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]
        );

        if (rows.length) {
            const userId = rows[0].id;

            // Rate limit: max 3 reset requests per user per hour
            const { rows: recent } = await pool.query(
                `SELECT COUNT(*) AS cnt FROM password_reset_tokens
                 WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
                [userId]
            );

            if (parseInt(recent[0].cnt, 10) < 3) {
                const token   = crypto.randomBytes(32).toString('hex');
                const expires = new Date(Date.now() + 60 * 60 * 1000);
                await pool.query(
                    `INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)`,
                    [userId, token, expires]
                );
                sendPasswordResetEmail(email.toLowerCase(), token).catch(err =>
                    console.error('[forgot-password] Email failed — userId:', userId, 'error:', err.message)
                );
            } else {
                console.log('[forgot-password] Rate limit reached for userId:', userId);
            }
        }

        // Always return success regardless of whether email was found
        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// POST /api/auth/reset-password
// Validates token, hashes new password, marks token used. Does NOT log user in.
// =============================================================================
router.post('/reset-password', async (req, res) => {
    try {
        const { token, password } = req.body;
        if (!token || !password) return res.status(400).json({ error: 'token and password required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        // Clean up expired tokens opportunistically
        await pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW()`);

        const { rows } = await pool.query(
            `SELECT id, user_id FROM password_reset_tokens
             WHERE token = $1 AND expires_at > NOW() AND used = false`,
            [token]
        );
        if (!rows.length)
            return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });

        const { id: tokenId, user_id: userId } = rows[0];
        const hash = await bcrypt.hash(password, 12);

        await Promise.all([
            pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId]),
            pool.query('UPDATE password_reset_tokens SET used = true WHERE id = $1', [tokenId]),
        ]);

        res.json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// =============================================================================
// GET /api/auth/me
// =============================================================================
router.get('/me', requireAuth, async (req, res) => {
    const { id } = (req as any).user;
    const { rows } = await pool.query(
        'SELECT id, email, role, verified, created_at FROM users WHERE id = $1', [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
});

export default router;
