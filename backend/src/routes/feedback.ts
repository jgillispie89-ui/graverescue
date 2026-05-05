import { Router, Request, Response } from 'express';
import { pool } from '../db.js';
import { verifyToken } from '../token.js';
import { sendFeedbackNotificationEmail } from '../email.js';

const router = Router();

const VALID_TYPES = new Set(['suggestion', 'bug_report', 'cemetery_correction', 'other']);

// In-memory rate limit store: key → timestamps[]
const rlStore = new Map<string, number[]>();

function isRateLimited(key: string, max: number): boolean {
    const now    = Date.now();
    const cutoff = now - 60 * 60 * 1000;
    const times  = (rlStore.get(key) ?? []).filter(t => t > cutoff);
    if (times.length >= max) return true;
    times.push(now);
    rlStore.set(key, times);
    return false;
}

router.post('/', async (req: Request, res: Response) => {
    try {
        // Resolve optional auth — don't reject if absent
        let user: any = null;
        const authH = req.headers.authorization;
        if (authH?.startsWith('Bearer ')) {
            try { user = verifyToken(authH.slice(7)); } catch {}
        }

        // Honeypot: silently succeed so bots think it worked
        if (req.body.hp || req.body.website)
            return res.status(201).json({ ok: true }) as any;

        const { type, subject, description, submitter_name, submitter_email } = req.body;

        // URL spam filter
        if (/https?:\/\//i.test(description || ''))
            return res.status(400).json({ error: 'Description may not contain URLs.' }) as any;

        // Validation
        if (!type || !subject?.trim() || !description?.trim())
            return res.status(400).json({ error: 'Type, subject, and description are required.' }) as any;
        if (subject.trim().length > 100)
            return res.status(400).json({ error: 'Subject must be 100 characters or less.' }) as any;
        if (description.trim().length > 2000)
            return res.status(400).json({ error: 'Description must be 2000 characters or less.' }) as any;
        if (!VALID_TYPES.has(type))
            return res.status(400).json({ error: 'Invalid feedback type.' }) as any;

        // Rate limit: 5/hr for anonymous, 10/hr for logged-in users
        const ip    = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim()
                      || (req.socket as any).remoteAddress || 'unknown';
        const rlKey = user ? `u:${user.id}` : `ip:${ip}`;
        const rlMax = user ? 10 : 5;
        if (isRateLimited(rlKey, rlMax))
            return res.status(429).json({ error: "Thanks for the enthusiasm! Please wait a bit before submitting more." }) as any;

        const { rows } = await pool.query(
            `INSERT INTO feedback (type, subject, description, submitter_name, submitter_email, submitter_user_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, created_at`,
            [type, subject.trim(), description.trim(),
             submitter_name?.trim()  || null,
             submitter_email?.trim() || null,
             user?.id || null]
        );

        const entry = rows[0];

        // Fire-and-forget — don't block the response
        sendFeedbackNotificationEmail({
            id:              entry.id,
            type,
            subject:         subject.trim(),
            description:     description.trim(),
            submitterName:   submitter_name?.trim()  || null,
            submitterEmail:  submitter_email?.trim() || null,
            submitterUserId: user?.id || null,
            createdAt:       entry.created_at,
        }).catch(err => console.error('[feedback] Email notification failed:', err.message));

        res.status(201).json({ ok: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
