import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from './_supabase.js';
import { cors } from './_helpers.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const { data, error } = await supabase
            .from('cemeteries_geojson')
            .select('*');

        if (error) throw error;

        const geojson = {
            type: 'FeatureCollection',
            features: data.map(c => ({
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [c.lng, c.lat],
                },
                properties: {
                    id: c.id,
                    name: c.name,
                    cemetery_type: c.cemetery_type,
                    rescue_status: c.rescue_status,
                    city: c.city,
                    state_province: c.state_province,
                    country: c.country,
                    description: c.description,
                    photo_url: c.photo_url,
                    photo_count: c.photo_count,
                    established_year: c.established_year,
                    last_known_year: c.last_known_year,
                    stone_count: c.stone_count,
                },
            })),
        };

        return res.json(geojson);
    } catch (err: any) {
        return res.status(500).json({ error: err.message });
    }
}
