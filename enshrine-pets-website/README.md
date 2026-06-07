# Enshrine 欣奉 — Pets Afterlife Services Website

A dignified one-page website for Enshrine with a built-in **admin backend** so non-technical
staff can edit all the wording and replace photos — no code required.

## What you can do in the admin

- **Edit every piece of text** on the site (headings, paragraphs, service descriptions, lists,
  contact details, footer, SEO title/description, etc.).
- **Upload / replace any photo** (hero, services, faiths, columbarium building, interior gallery,
  niches, logo).
- **Manage admin users** — add colleagues, change passwords, remove accounts (multi-user login).

Changes save instantly and appear on the live site.

## Run it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
cd enshrine-pets-website
npm install
npm start
```

Then open:

- Public site → http://localhost:20101/
- Admin panel → http://localhost:20101/admin

### First login

On first run an admin account is created automatically and printed in the terminal:

- **username:** `admin`
- **password:** `enshrine123`  (or whatever you set via the `ADMIN_PASSWORD` environment variable)

Log in, then go to **Users** and change the password / add your own accounts.

## How it works

| Path | Purpose |
|------|---------|
| `server.js` | Express server (public site, admin, auth, uploads). |
| `data/content.json` | All editable text & image paths. This is what the admin edits. |
| `data/users.json` | Admin accounts (passwords are hashed with bcrypt). Created on first run. |
| `views/index.ejs` | The public website template (renders from `content.json`). |
| `views/admin.ejs` | The content editor (auto-generated form). |
| `views/login.ejs`, `views/users.ejs` | Login & user management. |
| `public/css/` | Styles for the site and admin. |
| `public/images/` | Original photos. |
| `public/uploads/` | Photos uploaded through the admin. |

The editor form is generated automatically from `content.json`, so if you add new fields there
they will appear in the admin without further code changes.

## Configuration (optional)

Set environment variables before `npm start`:

- `PORT` — port to run on (default `20101`).
- `SESSION_SECRET` — secret for login sessions (recommended in production; otherwise a random one
  is generated each restart, which logs everyone out on restart).
- `ADMIN_PASSWORD` — password for the auto-seeded `admin` account on first run.

```bash
PORT=20102 SESSION_SECRET="a-long-random-string" npm start
```

## Deploying

This is a standard Node/Express app. It runs on Render, Railway, Fly.io, a VPS, etc.
Use a persistent disk (or database) for `data/` and `public/uploads/` so edits and uploaded
images survive restarts/redeploys.

## Security notes

- Passwords are stored hashed (bcrypt). `data/users.json` is git-ignored.
- Always set a strong `SESSION_SECRET` and change the default admin password in production.
- Put the site behind HTTPS when deployed.
