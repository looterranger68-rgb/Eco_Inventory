# EcoInventery

Clean, professional inventory & sales management web app for sellers — product
catalog with shelf-life tracking, QR code labels, and stock insights
(expiring-soon and underperforming item detection).

## Stack

- **Backend**: Node.js + Express, plain SQL (no ORM)
- **Database**: SQLite by default (zero setup), PostgreSQL optional
- **Auth**: bcrypt password hashing, JWT session in an httpOnly cookie
- **Frontend**: multi-page vanilla HTML/CSS/JS served from `/public`, no build step

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment (optional for SQLite)

```bash
cp .env.example .env
```

The app runs on SQLite out of the box — the database file is created at
`data/ecoinventory.db` automatically on first start.

#### Using PostgreSQL instead

1. Create a database:

   ```bash
   createdb ecoinventory
   # or: CREATE DATABASE ecoinventory; inside psql
   ```

2. Apply the schema:

   ```bash
   psql -d ecoinventory -f schema.sql
   ```

3. Set the connection in `.env`:

   ```env
   DATABASE_TYPE=postgres
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/ecoinventory
   ```

   (Individual `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` /
   `PG_PASSWORD` variables also work if you prefer not to use a URL.)

### 3. Set a JWT secret

Generate a strong secret and put it in `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))" >> .env
```

(Then rename the generated line to `JWT_SECRET=<value>`.)

### 4. Start the server

```bash
npm start        # production
npm run dev      # development, auto-restarts on file changes
```

The app listens on `http://localhost:3000` (override with `PORT` in `.env`).
SQLite tables are created and demo-seeded automatically on first start.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `NODE_ENV` | no | `development` | `production` enables `Secure` cookies |
| `DATABASE_TYPE` | no | `sqlite` | `sqlite` or `postgres` |
| `DATABASE_URL` | only for Postgres URL form | — | PostgreSQL connection string (overrides `PG_*`) |
| `PG_HOST` / `PG_PORT` / `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | only for Postgres var form | see `.env.example` | Individual PostgreSQL settings |
| `JWT_SECRET` | yes in production | dev fallback | Secret used to sign session JWTs |
| `BASE_URL` | no | `http://localhost:$PORT` | Public URL encoded into product QR codes |
| `GEMINI_API_KEY` | no | — | AI features |

## API overview

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | — | Create seller account (sets httpOnly JWT cookie) |
| `POST /api/auth/login` | — | Sign in |
| `POST /api/auth/logout` | — | Clear session cookie |
| `GET /api/auth/me` | ✓ | Current seller profile |
| `POST /api/products` | ✓ | Create product (validates `expiry_date > mfg_date`) |
| `GET /api/products` | ✓ | List the signed-in seller's products |
| `PUT /api/products/:id` | ✓ | Update product (partial) |
| `DELETE /api/products/:id` | ✓ | Delete product |
| `POST /api/products/:id/generate-qr` | ✓ | Generate QR PNG for the public page |
| `GET /api/insights` | ✓ | Expiring-soon (`?days=N`) & underperforming (`?threshold=X`) lists |

Scanning a QR code opens `GET /p/{slug}` — a public, no-auth, mobile-friendly
product page.

## Demo account

On first SQLite start the app seeds a demo seller:

- Email: `seller@ecoinventery.com`
- Password: `demo1234`
