# Bug Fix: Intern Edit Buttons (Edit Profile, Edit Gender & Edit Dates)

- **Slug**: edit-gender-button
- **Fixed**: 2026-10-21
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Fixed the "✏️ Edit Profile", "✏️ Edit Gender", and "✏️ Edit Dates" buttons in the Intern Details Modal (`#modal-intern-details`) and cleaned up the backend route/configuration overrides so that all three edit modals open reliably, normalize date values for `<input type="date">`, fall back to fetching `/api/interns/<id>` if `window.currentViewingIntern` is unset, and persist updates via `PATCH /api/interns/<id>/profile`, `PATCH /api/interns/<id>/gender`, and `PATCH /api/interns/<id>/dates`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `app/static/js/app.js` | modified | Hardened `openEditInternDatesModal`, `openEditInternGenderModal`, and `openEditInternFullProfileModal` with API fallback (`GET /api/interns/${internId}`), ISO date normalization (`String(rawDate).split('T')[0]`), and explicit `window.*` bindings. |
| `app/templates/index.html` | modified | Ensured edit modal overlays carry elevated `z-index` (`2100`/`2200`) and bumped cache-buster query string to `app.js?v=1792572000`. |
| `app/routes/web.py` | modified | Removed leftover debug override in `index()` so `GET /` cleanly renders `index.html`. |
| `app/__init__.py` | modified | Added `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` headers for `/` and `.js` assets to prevent stale script caching. |
| `config.py` | modified | Restored default `DATABASE_URL` fallback to `postgresql://postgres:alvi420@localhost:5432/intern-flask`. |
| `.env` | modified | Restored `DATABASE_URL` to `postgresql://postgres:alvi420@localhost:5432/intern-flask`. |
| `run.py` | modified | Restored `debug=True` on `app.run(...)` so template and Python changes auto-reload. |

## Diff Highlights

```html
<!-- app/templates/index.html -->
<script src="/static/js/app.js?v=1792572000"></script>
```

```javascript
// app/static/js/app.js
function openEditInternDatesModal(internId, startDate, endDate, internName) {
  const intern = (window.currentViewingIntern && window.currentViewingIntern.id == internId) ? window.currentViewingIntern : null;
  if (!intern && !startDate && !endDate && !internName) {
    api(`/api/interns/${internId}`).then(res => {
      if (res.ok && res.data && res.data.intern) {
        window.currentViewingIntern = res.data.intern;
        openEditInternDatesModal(internId);
      }
    });
    return;
  }
  const rawStart = (intern && intern.start_date) || startDate || '';
  const rawEnd = (intern && intern.end_date) || endDate || '';
  const sDate = rawStart ? String(rawStart).split('T')[0] : '';
  const eDate = rawEnd ? String(rawEnd).split('T')[0] : '';
  const nameToSet = (intern && intern.full_name) || internName || 'Intern';
  ...
  updateEditDatesDurationPreview();
  openModal('modal-edit-intern-dates');
}
window.openEditInternDatesModal = openEditInternDatesModal;

function openEditInternGenderModal(internId, currentGender, internName) {
  const intern = (window.currentViewingIntern && window.currentViewingIntern.id == internId) ? window.currentViewingIntern : null;
  if (!intern && !currentGender && !internName) {
    api(`/api/interns/${internId}`).then(res => {
      if (res.ok && res.data && res.data.intern) {
        window.currentViewingIntern = res.data.intern;
        openEditInternGenderModal(internId);
      }
    });
    return;
  }
  const genderToSet = (intern && intern.gender) || currentGender || '';
  const nameToSet = (intern && intern.full_name) || internName || 'Intern';
  ...
  openModal('modal-edit-intern-gender');
}
window.openEditInternGenderModal = openEditInternGenderModal;
```

## Local Verification

- **JavaScript Syntax Check**: `node -c app/static/js/app.js` passed with zero syntax errors.
- **Flask Application & Route Verification**: Verified via Flask `test_client()` that `GET /` returns HTTP 200 with `app.js?v=1792572000` and `Cache-Control: no-store`, and confirmed `/api/interns/<int:intern_id>/gender`, `/api/interns/<int:intern_id>/dates`, and `/api/interns/<int:intern_id>/profile` are registered on `url_map`.
- **Modal Stacking Context**: Verified `#modal-edit-intern-dates` (`z-index: 2100`), `#modal-edit-intern-gender` (`z-index: 2100`), and `#modal-edit-intern-full-profile` (`z-index: 2200`) render above `#modal-intern-details` (`z-index: 1000`).

## Deviations from Assessment

None.

## Follow-ups

- If the background systemd service (`intern-management.service`) was started while `use_reloader=False` was present in `run.py`, run `sudo systemctl restart intern-management.service` and hard-refresh the browser (`Ctrl+F5`) so the running worker loads the updated routes and template.
