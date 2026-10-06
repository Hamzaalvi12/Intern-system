# FSZ — Full Stack Zone Enterprise Intern Management System

A secure, role-based, full-stack **Intern Management System** built with **Flask**, **PostgreSQL**, **Flask-SQLAlchemy**, **Flask-JWT-Extended**, and a modern dark glassmorphic responsive frontend.

---

## 🚀 Key Requirements & Implementation

| # | Requirement | Implementation & Security Enforcement |
|---|-------------|---------------------------------------|
| **1** | **Intern Registration & Approval-Gated Login** | Interns register with full profile (`role='intern'`, `status='pending'`). Interns **CANNOT** log in until an administrator reviews and approves their account (`PATCH /api/interns/<id>/approve`). Attempting to log in before approval yields `403 Forbidden` with a descriptive message. |
| **2** | **Admin Intern Directory & Super Admin Governance** | Administrators (`admin`, `super_admin`) have access to view all intern accounts, filter by status (`pending`, `approved`, `rejected`), search, and inspect metrics. **ONLY** `super_admin` can create secondary/other admin accounts (`POST /api/auth/create-admin`); standard admins are blocked (`403 Forbidden`). |
| **3** | **Admin Creates & Assigns Tasks** | Admins can create tasks with priority, due date, description, and assign them to approved interns (`POST /api/tasks`). |
| **4** | **Interns Cannot Create Tasks** | The `POST /api/tasks` endpoint is protected by `@admin_or_super_admin_required`. Intern attempts are rejected with `403 Forbidden`. |
| **5** | **Interns Update Task Status** | Interns can update tasks assigned to them to `pending`, `in_progress`, or `completed` (`PATCH /api/tasks/<id>/status`). Interns can only update their own tasks; unauthorized attempts return `403 Forbidden`. |
| **6** | **Internship Accomplishment Letters & Certificates** | Dedicated admin view & management (`GET /api/letters`, `POST /api/letters`). Admins issue verifiable letters upon internship completion. Features a printable, high-resolution certificate with gold foil styling, custom seal, and unique verification ID. |
| **7** | **Intern Attendance Tracking** | Interns record daily attendance (`POST /api/attendance/check-in` & `/check-out`). Edge case protection: duplicate check-ins on the same day are blocked (`400 Bad Request`). System tracks check-in time, check-out time, total hours, and status (`present`, `late`, `wfh`). |
| **8** | **Intern-to-Admin Messaging System** | Interns can send inquiries/messages directly to the administration pool or specific admins (`POST /api/messages`). Admins view inquiries and reply in threaded conversations (`POST /api/messages/<id>/reply`). |

---

## 🔐 Security Architecture

- **Authentication**: JWT tokens (`Flask-JWT-Extended`) with HMAC-SHA256 signatures (64-byte key) and expiration handling.
- **Authorization**: Custom role decorators (`@super_admin_required`, `@admin_or_super_admin_required`, `@intern_required`, `@any_authenticated_user`).
- **Password Security**: Strong hashing with `werkzeug.security` (salted `scrypt`/`pbkdf2:sha256`).
- **Data Validation & Sanitization**: Validates emails, required fields, date formats, status enums, and ownership verification on all resource updates.
- **SQL Injection Prevention**: Full SQLAlchemy ORM parameterized queries.

---

## 👥 Default Demo Credentials

Pre-seeded in the database for instant testing:

| Role | Email | Password | Status | Notes |
|------|-------|----------|--------|-------|
| **Super Admin** | `superadmin@internhub.com` | `Password123!` | `approved` | Can create new admins, issue letters, approve interns |
| **Regular Admin** | `admin@internhub.com` | `Password123!` | `approved` | Can manage interns, tasks, letters, attendance |
| **Approved Intern** | `alex.intern@example.com` | `Password123!` | `approved` | Active intern (Alex Rivera) |
| **Pending Intern** | `david.pending@example.com` | `Password123!` | `pending` | Test admin approval workflow |

---

## 🛠️ Technology Stack

- **Backend**: Python 3.14, Flask 3.1, Flask-SQLAlchemy 3.1, Flask-JWT-Extended 4.7, Flask-Migrate 4.1, psycopg2-binary
- **Database**: PostgreSQL (`intern-flask`)
- **Frontend**: HTML5, Vanilla CSS3 (Custom Glassmorphism Design System, responsive grid, micro-animations), Vanilla JavaScript (ES6+)

---

## 🏃 Running the Application

### 1. Activate Virtual Environment & Seed Database
```bash
source venv/bin/activate
python seed.py
```

### 2. Run Automated Test Suite
```bash
python test_system.py
```

### 3. Start the Server
```bash
python run.py
```
Open **[http://127.0.0.1:5000](http://127.0.0.1:5000)** in your browser.

---

## 📡 API Reference Overview

### Auth
- `POST /api/auth/register` - Intern registration (status set to `pending`)
- `POST /api/auth/login` - Authenticate & obtain JWT (blocks unapproved interns)
- `POST /api/auth/change-password` - Update current user password (Admins, Super Admins, Interns)
- `GET /api/auth/me` - Current authenticated user profile
- `POST /api/auth/create-admin` - Provision admin (**Super Admin only**)
- `GET /api/auth/admins` - List all admins (**Super Admin only**)

### Interns (Admin Only)
- `GET /api/interns?status=&search=` - Directory of interns with counts
- `GET /api/interns/<id>` - Full intern profile with tasks, attendance & letters
- `PATCH /api/interns/<id>/approve` - Approve intern account for login
- `PATCH /api/interns/<id>/reject` - Reject intern application with reason

### Tasks
- `POST /api/tasks` - Create & assign task (**Admin only**, interns blocked)
- `GET /api/tasks` - List tasks (Admins see all; Interns only see their assigned tasks)
- `GET /api/tasks/<id>` - Task details (ownership validated)
- `PATCH /api/tasks/<id>/status` - Update task status (`pending`, `in_progress`, `completed`)
- `PUT /api/tasks/<id>` - Edit task (**Admin only**)
- `DELETE /api/tasks/<id>` - Delete task (**Admin only**)

### Attendance
- `POST /api/attendance/check-in` - Mark attendance for today (blocks duplicate check-ins)
- `POST /api/attendance/check-out` - Check out and compute total hours
- `GET /api/attendance/my` - Intern attendance history & metrics
- `GET /api/attendance/all` - Attendance logs of all interns (**Admin only**)

### Internship Letters & Dedicated Registry
- `GET /admin/letters` - **Dedicated fullscreen registry page** displaying all issued certificate letters and whom each was issued to
- `POST /api/letters` - Issue completion certificate & letter (**Admin only**)
- `GET /api/letters` - List all issued letters (**Admin only**)
- `GET /api/letters/my` - Intern view of their letters
- `GET /api/letters/<id>` - Letter details
- `GET /certificate/<letter_number>` - Fullscreen high-resolution printable certificate

### Messages
- `POST /api/messages` - Send inquiry to administration
- `GET /api/messages` - View messages (Admin inbox or Intern outbox)
- `POST /api/messages/<id>/reply` - Reply to message thread
- `PATCH /api/messages/<id>/read` - Mark message as read

