import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_supabase.js';
import { getUser, cors } from './_helpers.js';

const VALID_TYPES = new Set(['suggestion', 'bug_report', 'cemetery_correction', 'other']);

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const user = await getUser(req);

        if (req.body.hp || req.body.website) return res.status(201).json({ ok: true });

        const { type, subject, description, submitter_name, submitter_email } = req.body;

        if (/https?:\/\//i.test(description || ''))
            return res.status(400).json({ error: 'Description may not contain URLs.' });
        if (!type || !subject?.trim() || !description?.trim())
            return res.status(400).json({ error: 'Type, subject, and description are required.' });
        if (subject.trim().length > 100)
            return res.status(400).json({ error: 'Subject must be 100 characters or less.' });
        if (description.trim().length > 2000)
            return res.status(400).json({ error: 'Description must be 2000 characters or less.' });
        if (!VALID_TYPES.has(type))
            return res.status(400).json({ error: 'Invalid feedback type.' });

        const ip    = ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() || 'unknown';
        const rlKey = user ? `u:${user.id}` : `ip:${ip}`;
        const rlMax = user ? 10 : 5;
        if (isRateLimited(rlKey, rlMax))
            return res.status(429).json({ error: 'Thanks for the enthusiasm! Please wait a bit before submitting more.' });

        const { data: entry, error } = await supabase.from('feedback').insert({
            type,
            subject:           subject.trim(),
            description:       description.trim(),
            submitter_name:    submitter_name?.trim()  || null,
            submitter_email:   submitter_email?.trim() || null,
            submitter_user_id: user?.id || null,
        }).select('id, created_at').single();

        if (error) throw error;

        if (process.env.RESEND_API_KEY) {
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            resend.emails.send({
                from:    process.env.RESEND_FROM_EMAIL!,
                to:      process.env.ADMIN_NOTIFY_EMAIL!,
                subject: `[GraveRescue Feedback] ${type}: ${subject.trim()}`,
                text:    `Type: ${type}\nSubject: ${subject.trim()}\n\n${description.trim()}\n\nFrom: ${submitter_name || 'Anonymous'} <${submitter_email || 'no email'}>`,
            }).catch(e => console.error('[feedback] Email failed:', e.message));
        }

        return res.status(201).json({ ok: true });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}
