import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabase.js';
import { getUser, cors } from '../_helpers.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action } = req.query;

    if (req.method === 'GET' && action === 'me') {
        const user = await getUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const { data: profile } = await supabase
            .from('users')
            .select('id, email, role, verified, created_at')
            .eq('id', user.id)
            .single();
        if (!profile) return res.status(404).json({ error: 'Not found' });
        return res.json(profile);
    }

    if (req.method === 'POST' && action === 'resend-verification') {
        const user = await getUser(req);
        if (!user) return res.status(401).json({ error: 'Unauthorized' });
        const { error } = await supabase.auth.resend({
            type: 'signup',
            email: user.email!,
        });
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ ok: true });
    }

    if (req.method === 'POST' && action === 'forgot-password') {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        await supabase.auth.resetPasswordForEmail(email.toLowerCase(), {
            redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
        }).catch(() => {});
        return res.json({ ok: true });
    }

    if (req.method === 'POST' && action === 'reset-password') {
        const { token, password } = req.body;
        if (!token || !password) return res.status(400).json({ error: 'token and password required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
        const { data, error } = await supabase.auth.exchangeCodeForSession(token);
        if (error) return res.status(400).json({ error: 'This reset link is invalid or has expired. Please request a new one.' });
        const { error: updateError } = await supabase.auth.admin.updateUserById(data.user.id, { password });
        if (updateError) return res.status(500).json({ error: updateError.message });
        return res.json({ ok: true });
    }

    return res.status(404).json({ error: 'Not found' });
}
