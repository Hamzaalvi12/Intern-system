# Bug Assessment: Intern Edit Buttons (Edit Profile, Edit Gender & Edit Dates) Not Functioning

- **Slug**: edit-gender-button
- **Created**: 2026-10-21
- **Source**: pasted text ("edit button not workiing" with attached Intern Details modal screenshot)
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

The user reported (`edit button not workiing`) with a screenshot of the Intern Details Modal (`Hasnain Abbas`, `ID: BTC-2026-0008`) showing three edit buttons: "✏️ Edit Profile", "✏️ Edit Gender", and "✏️ Edit Dates". Clicking these buttons does not open the respective update modals or fails to save changes.

## Symptom

When an administrator clicks "✏️ Edit Profile", "✏️ Edit Gender", or "✏️ Edit Dates" in the Intern Details Modal (`#modal-intern-details`), the corresponding edit modal either fails to open or API requests (`PATCH /api/interns/<id>/gender`, `PATCH /api/interns/<id>/dates`, `PATCH /api/interns/<id>/profile`) fail with 404/500 errors. Additionally, navigating to `/` after a server reload returns plain text debug output instead of `index.html`.

## Reproduction

1. Log in as an Administrator or Super Admin.
2. Open the Admin Overview / Interns view and click on an intern (e.g., "Hasnain Abbas") to open the Intern Details modal (`#modal-intern-details`).
3. Click on "✏️ Edit Profile", "✏️ Edit Gender", or "✏️ Edit Dates".
4. Observed:
   - The running `intern-management.service` worker (started Oct 20 with `use_reloader=False`) is still serving a stale version of `index.html` (`app.js?v=1790650000`) and stale Python routes before `/gender` and `/profile` endpoints were registered.
   - `app/routes/web.py` has leftover debug code in `index()` (`return f"SUCCESS: Found user {user.email}"`) before `return render_template('index.html')` and `config.py`/`.env` point to a non-existent `/tmp/sockets` PostgreSQL socket instead of `localhost:5432`.
   - In `app/static/js/app.js`, `openEditInternDatesModal` and `openEditInternGenderModal` rely on `window.currentViewingIntern` without an API fallback if `window.currentViewingIntern` is unset, and `openEditInternDatesModal` does not normalize ISO date strings (`split('T')[0]`) for `<input type="date">`.

## Suspected Code Paths

- `app/routes/web.py:20-39` — Debug code inside `index()` overrides `SQLALCHEMY_DATABASE_URI` with `/tmp/sockets` and returns plain text before `render_template('index.html')`.
- `config.py:9` & `.env:3` — `DATABASE_URL` configured with `?host=/tmp/sockets` instead of `localhost:5432`.
- `run.py:13` — `app.run(..., debug=False, use_reloader=False)` prevents the `intern-management.service` from picking up Python and template changes without a restart.
- `app/static/js/app.js:1238,1252,1258` — Inline `onclick` handlers for `openEditInternFullProfileModal`, `openEditInternGenderModal`, and `openEditInternDatesModal`.
- `app/static/js/app.js:1904-1920,1972-1984` — `openEditInternDatesModal` and `openEditInternGenderModal` implementations.
- `app/templates/index.html:1496,1528,1557,2406` — Edit modals (`#modal-edit-intern-dates`, `#modal-edit-intern-gender`, `#modal-edit-intern-full-profile`) and cache-busting query string on `app.js`.

## Root Cause Hypothesis

There are three compounding root causes:
1. **Stale Server Process & Disabled Reloader**: The systemd service (`intern-management.service`) is running an old Python process with `use_reloader=False` that serves cached templates (`app.js?v=1790650000`) and lacks the newly added `/api/interns/<id>/gender` and `/api/interns/<id>/profile` routes.
2. **Broken Database Socket & Debug Override**: `.env`, `config.py`, and `app/routes/web.py` were modified with a temporary `/tmp/sockets` PostgreSQL URI and early `return` statement in `index()`, which breaks the main dashboard route if the server restarts without cleaning it up.
3. **Frontend Modal State & Date Formatting**: `openEditInternDatesModal` and `openEditInternGenderModal` do not fallback to fetching `/api/interns/${internId}` if `window.currentViewingIntern` is missing, and `openEditInternDatesModal` does not strip time components (`split('T')[0]`) when populating `<input type="date">`.
Confidence: high.

## Proposed Remediation

**Preferred**:
1. Remove the temporary debug block in `app/routes/web.py` so `index()` cleanly renders `index.html`, and restore `localhost:5432` in `.env` and `config.py`.
2. Harden `openEditInternDatesModal`, `openEditInternGenderModal`, and `openEditInternFullProfileModal` in `app/static/js/app.js` so all three buttons fall back to fetching `/api/interns/${internId}` if `window.currentViewingIntern` is not populated, properly format dates (`split('T')[0]`), and attach functions explicitly to `window`.
3. Bump the static cache-busting query string in `app/templates/index.html` and reload the running Flask application process so the updated templates and backend routes (`/gender`, `/dates`, `/profile`) are actively served.

**Files likely to change**:
- `app/routes/web.py`
- `config.py`
- `.env`
- `app/static/js/app.js`
- `app/templates/index.html`

**Tests to add or update**:
- Verify `GET /` serves the full HTML dashboard with the updated `app.js?v=...` script tag.
- Verify `PATCH /api/interns/<id>/gender`, `PATCH /api/interns/<id>/dates`, and `PATCH /api/interns/<id>/profile` return HTTP 200 and persist changes.

## Risks & Considerations

- Restarting or reloading the active Flask process must maintain database connectivity on `localhost:5432`.
- Modal `z-index` values (`2100`/`2200`) must remain above `#modal-intern-details` (`1000`).

## Open Questions

- None.
