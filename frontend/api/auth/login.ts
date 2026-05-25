import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabase.js';
import { cors } from '../_helpers.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password required' });

        const { data, error } = await supabase.auth.signInWithPassword({
            email: email.toLowerCase(),
            password,
        });
        if (error) return res.status(401).json({ error: 'Invalid email or password' });

        const { data: profile } = await supabase
            .from('users')
            .select('role, verified, display_name')
            .eq('id', data.user.id)
            .single();

        return res.json({
            token: data.session.access_token,
            user: {
                id: data.user.id,
                email: data.user.email,
                role: profile?.role || 'contributor',
                verified: profile?.verified || false,
            },
        });
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}
