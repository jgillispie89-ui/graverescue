# GraveRescue — Forgotten Cemetery Atlas

An interactive atlas documenting forgotten cemeteries across America: family farm plots, slave cemeteries, prison cemeteries, freedmen graveyards, asylum burial grounds, unmarked graves, and more.

## Tech stack

| Layer | Choice |
|---|---|
| Map | MapLibre GL JS + OpenStreetMap |
| Frontend | Vanilla JS + Vite → Netlify |
| Backend | Node.js + Express + TypeScript → Render |
| Database | PostgreSQL 16 + PostGIS → Neon |
| Photos | Cloudflare R2 |
| Email | Resend |

## How to run locally

```bash
# Database (requires Postgres 16 + PostGIS)
psql -U postgres -c "CREATE DATABASE graverescue;"
psql -U postgres -d graverescue -f db/schema.sql

# Backend
cd backend && cp .env.example .env   # fill in your values
npm install && npm run dev            # http://localhost:3001

# Frontend
cd frontend && npm install && npm run dev   # http://localhost:5173
```

## Environment variables (backend)

See `backend/.env.example` for the full list. Key vars for Render:

- `DATABASE_URL` — Neon PostgreSQL connection string
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` — email delivery
- `ADMIN_NOTIFY_EMAIL` — where moderation alerts go
- `FRONTEND_URL` — `https://graverescue.com` in production
- `CORS_ORIGIN` — `https://graverescue.com` in production
- `JWT_SECRET` — random 64-char hex string

## Environment variables (frontend / Netlify)

- `VITE_API_BASE` — `https://graverescue-api.onrender.com` in production

## Cemetery types

`family_farm` · `church_community` · `rural_community` · `urban` · `slave_cemetery` · `african_american` · `freedmen` · `prison` · `asylum_state_hospital` · `poor_farm_potters_field` · `military_veterans` · `religious_minority` · `epidemic_mass_burial` · `unmarked_unnamed` · `single_stone` · `unknown_other`

## Rescue statuses

`maintained` · `neglected` · `overgrown` · `lost` · `reclaimed`
