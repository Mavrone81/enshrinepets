# enshrinepets — Enshrine Pets public website
> Public site for Enshrine Pets. LIVE at enshrinepets.com.sg (host 165).

## Stack
Node/Express + EJS (`enshrine-pets-website/`), multi-user admin (bcrypt), image uploads, session auth.
## Run
See `enshrine-pets-website/` (`npm start`); admin at `/admin/login`.
## Deploy
165 via `auto-deploy-enshrinepets.sh` (pm2 restart). Push-to-deploy.
## Gotchas
Login now rate-limited (5 failed/(user,IP)/15min; `trust proxy` added — was missing, which would have collapsed all users to one key). Content docs: ADMIN-GUIDE, SEO-Playbook.
## Current state
`main` @ e58d3d1 (hero curve tweak) + login throttle 917d9b8.
_Overview generated 2026-08-13 during migration._
