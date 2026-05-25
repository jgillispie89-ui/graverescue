import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../_supabase.js';
import { requireAdmin, cors } from '../_helpers.js';

export default requireAdmin(async (req: VercelRequest, res: VercelResponse, adminUser: any) => {
    cors(req, res);
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { slug } = req.query;
    const parts = Array.isArray(slug) ? slug : [slug];
    const route = parts.join('/');

    if (req.method === 'GET' && route === 'queue') {
        const { data: rows, error } = await supabase
            .from('cemeteries')
            .select('id, name, cemetery_type, rescue_status, mod_status, city, state_province, established_year, last_known_year, description, created_at, mod_note, submitted_by')
            .eq('mod_status', 'pending')
            .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.json(rows);
    }

    if (req.method === 'POST' && parts[0] === 'approve') {
        const { data, error } = await supabase
            .from('cemeteries')
            .update({ mod_status: 'approved', mod_note: req.body.note || null })
            .eq('id', parts[1])
            .select('id, name')
            .single();
        if (error) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true, cemetery: data });
    }

    if (req.method === 'POST' && parts[0] === 'reject') {
        const { data, error } = await supabase
            .from('cemeteries')
            .update({ mod_status: 'rejected', mod_note: req.body.note || null })
            .eq('id', parts[1])
            .select('id, name')
            .single();
        if (error) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true, cemetery: data });
    }

    if (req.method === 'GET' && route === 'unverified-users') {
        const { data, error } = await supabase
            .from('users')
            .select('id, email, verified, email_send_failed, email_send_error, created_at')
            .eq('verified', false)
            .order('created_at', { ascending: false });
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    if (req.method === 'POST' && route === 'verify-user') {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        const { data: userRow } = await supabase.from('users').select('id').ilike('email', email).single();
        if (!userRow) return res.status(404).json({ error: 'User not found' });
        await supabase.auth.admin.updateUserById(userRow.id, { email_confirm: true });
        const { data, error } = await supabase
            .from('users')
            .update({ verified: true, email_send_failed: false, email_send_error: null })
            .ilike('email', email)
            .select('id, email, role')
            .single();
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ ok: true, user: data });
    }

    if (req.method === 'GET' && route === 'feedback/new-count') {
        const { count, error } = await supabase
            .from('feedback')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'new');
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ count });
    }

    if (req.method === 'GET' && route === 'feedback') {
        const showAll = req.query.show_all === '1';
        let query = supabase.from('feedback').select('*').order('created_at', { ascending: false });
        if (!showAll) query = query.not('status', 'in', '("resolved","dismissed")');
        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    if (req.method === 'PATCH' && parts[0] === 'feedback') {
        const updates: any = { updated_at: new Date().toISOString() };
        if (req.body.status      !== undefined) updates.status      = req.body.status;
        if (req.body.admin_notes !== undefined) updates.admin_notes = req.body.admin_notes || null;
        const { data, error } = await supabase.from('feedback').update(updates).eq('id', parts[1]).select('*').single();
        if (error) return res.status(404).json({ error: 'Not found' });
        return res.json(data);
    }

    if (req.method === 'DELETE' && parts[0] === 'feedback') {
        const { error } = await supabase.from('feedback').delete().eq('id', parts[1]);
        if (error) return res.status(404).json({ error: 'Not found' });
        return res.json({ ok: true });
    }

    if (req.method === 'POST' && route === 'send-password-reset') {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase(), {
            redirectTo: `${process.env.FRONTEND_URL}/reset-password`,
        });
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ ok: true });
    }

    if (req.method === 'GET' && route === 'headstones/recent') {
        const since = req.query.since as string | undefined;
        let query = supabase
            .from('headstones')
            .select('id, name, cemetery_id, photo_url, thumb_url, created_at, submitted_by, cemeteries(name), users(email)')
            .eq('mod_status', 'approved')
            .order('created_at', { ascending: false })
            .limit(100);
        if (since) query = query.gt('created_at', since);
        const { data, error } = await query;
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    if (req.method === 'DELETE' && parts[0] === 'headstones') {
        const { error } = await supabase.from('headstones').delete().eq('id', parts[1]);
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ ok: true });
    }

    if (req.method === 'GET' && route === 'headstone-edits/queue') {
        const { data, error } = await supabase
            .from('headstone_edits')
            .select('*, headstones(name, birth_year, birth_month, birth_day, birth_place, death_year, death_month, death_day, death_place, inscription, relationship, condition, photo_url, cemetery_id, cemeteries(name)), users(email)')
            .eq('status', 'pending')
            .order('created_at', { ascending: true });
        if (error) return res.status(500).json({ error: error.message });
        return res.json(data);
    }

    if (req.method === 'GET' && route === 'headstone-edits/queue-count') {
        const { count, error } = await supabase
            .from('headstone_edits')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');
        if (error) return res.status(500).json({ error: error.message });
        return res.json({ count });
    }

    if (req.method === 'POST' && parts[0] === 'headstone-edits' && parts[1] === 'approve') {
        const { data: edit, error: fetchErr } = await supabase
            .from('headstone_edits').select('*').eq('id', parts[2]).single();
        if (fetchErr) return res.status(404).json({ error: 'Not found' });
        const d = edit.proposed_data as any;
        await supabase.from('headstones').update({
            name:         d.name         || undefined,
            birth_year:   d.birth_year   ?? null,
            birth_month:  d.birth_month  ?? null,
            birth_day:    d.birth_day    ?? null,
            birth_place:  d.birth_place  ?? null,
            death_year:   d.death_year   ?? null,
            death_month:  d.death_month  ?? null,
            death_day:    d.death_day    ?? null,
            death_place:  d.death_place  ?? null,
            inscription:  d.inscription  ?? null,
            relationship: d.relationship ?? null,
            condition:    d.condition    ?? null,
            photo_url:    d.photo_url    ?? null,
            updated_at:   new Date().toISOString(),
        }).eq('id', edit.headstone_id);
        await supabase.from('headstone_edits').update({
            status: 'approved', reviewed_by: adminUser.id, reviewed_at: new Date().toISOString(),
        }).eq('id', parts[2]);
        return res.json({ ok: true });
    }

    if (req.method === 'POST' && parts[0] === 'headstone-edits' && parts[1] === 'reject') {
        await supabase.from('headstone_edits').update({
            status: 'rejected', reviewed_by: adminUser.id, reviewed_at: new Date().toISOString(),
        }).eq('id', parts[2]);
        return res.json({ ok: true });
    }

    return res.status(404).json({ error: 'Not found' });
});
