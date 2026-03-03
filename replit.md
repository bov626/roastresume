# Roast Prototype

A resume "roasting" submission pipeline. Visitors submit their resume via the landing page, and an admin reviews/manages submissions through a password-protected admin panel.

## Architecture

- **Runtime**: Node.js 20
- **Framework**: Express 5
- **Database**: SQLite via `better-sqlite3` (file: `submissions.db`)
- **File uploads**: Multer (resumes + roast videos stored in `uploads/`)

## Project Structure

- `server.js` — Main Express server (serves everything: landing page, API, admin panel)
- `index.html` — Landing page (resume submission form)
- `submissions.db` — SQLite database (auto-created on startup)
- `uploads/` — Uploaded resumes and videos (auto-created on startup)

## Running

The server runs on port `5000` bound to `0.0.0.0`.

```
node server.js
```

## Key Routes

- `GET /` — Landing page (index.html)
- `POST /api/submit` — Public form submission endpoint (name, email, optional resume file)
- `GET /admin` — Admin dashboard (password protected)
- `GET /admin/login` — Admin login page
- `GET /admin/api/submissions` — List all submissions (JSON)
- `POST /admin/api/status` — Update submission status
- `POST /admin/api/notes` — Save notes on a submission
- `POST /admin/api/upload-video/:id` — Upload roast video for a submission
- `GET /admin/uploads/:filename` — Download resume or video file

## Admin Access

Password: `jumpseat2026`

## Submission Statuses

`new` → `picked` → `editing` → `done` (or `skipped`)

## Dependencies

- `express` — Web framework
- `express-session` — Session-based auth for admin
- `better-sqlite3` — SQLite database (native module, must be rebuilt with `npm rebuild better-sqlite3`)
- `multer` — File upload handling
- `uuid` — Unique filenames for uploads
