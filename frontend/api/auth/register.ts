import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabase.js';
import { cors } from '../_helpers.js';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'contributor';
        const displayName = email.split('@')[0];

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
            email: email.toLowerCase(),
            password,
            email_confirm: false,
        });
        if (authError) {
            if (authError.message.includes('already registered'))
                return res.status(409).json({ error: 'Email already registered' });
            return res.status(400).json({ error: authError.message });
        }

        const userId = authData.user.id;

        await supabase.from('users').insert({
            id: userId,
            email: email.toLowerCase(),
            display_name: displayName,
            role,
            verified: false,
        });

        await supabase.auth.admin.generateLink({
            type: 'signup',
            email: email.toLowerCase(),
        });

        if (process.env.RESEND_API_KEY) {
            const { Resend } = await import('resend');
            const resend = new Resend(process.env.RESEND_API_KEY);
            await resend.emails.send({
                from: process.env.RESEND_FROM_EMAIL!,
                to: process.env.ADMIN_NOTIFY_EMAIL!,
                subject: 'New GraveRescue registration',
                text: `New user registered: ${email} (${role})`,
            }).catch(e => console.error('Admin notification failed:', e.message));
        }

        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password,
        });
        if (signInError) return res.status(500).json({ error: signInError.message });

        return res.status(201).json({
            token: signInData.session?.access_token,
            user: { id: userId, email: email.toLowerCase(), role, verified: false },
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}
