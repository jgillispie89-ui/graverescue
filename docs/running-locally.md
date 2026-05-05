# How to run GraveRescue on your computer

The first time through, this takes about 30–45 minutes. Most of that is installing PostgreSQL + PostGIS if you don't have them. After that, `npm run dev` in each folder gets you going in seconds.

## 1. Install prerequisites

You need three things:

- **Node.js 20 or newer** — https://nodejs.org (pick the LTS installer)
- **PostgreSQL 16** — https://www.postgresql.org/download
- **PostGIS extension** — bundled in the Windows "Stack Builder" wizard after PG install, or on macOS `brew install postgis`, or on Linux `sudo apt install postgresql-16-postgis-3`

To verify:
```bash
node -v        # should print v20.x or higher
psql --version # should print psql (PostgreSQL) 16.x
```

## 2. Create the database

```bash
createdb graverescue
psql -d graverescue -c "CREATE EXTENSION postgis;"

cd path/to/graverescue
psql -d graverescue -f db/schema.sql
```

## 3. Start the backend

```bash
cd backend
cp .env.example .env
# Edit .env — set DATABASE_URL to your local Postgres connection string
npm install
npm run dev
```

Leave this terminal running. You should see: `GraveRescue API listening on http://localhost:3001`

Test it: open http://localhost:3001/api/health — you should get `{"ok":true,"postgis":"3.x..."}`.

## 4. Start the frontend

Open a **second** terminal:
```bash
cd frontend
npm install
npm run dev
```

Visit **http://localhost:5173**. You should see a map centered on the US. The backend serves cemeteries; without any data yet you'll see the fallback sample markers.

## Troubleshooting

- **`psql: command not found`** — Postgres isn't on your PATH. On Windows, use the "SQL Shell (psql)" from the Start menu.
- **Backend says `ECONNREFUSED`** — Postgres isn't running. Start it from Services (Windows) or `brew services start postgresql@16`.
- **Frontend loads but map is empty** — check the backend terminal for errors, then the browser devtools Network tab. The frontend falls back to embedded sample data if the API is unreachable.
