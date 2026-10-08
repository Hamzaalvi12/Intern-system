import unittest
import io
import os
import time
from app import create_app
from app.models import db, User, Task, Attendance, InternshipLetter, Message, TaskProgressUpdate
from app.utils import reset_rate_limit

class SecurityAndSQATestSuite(unittest.TestCase):
    """
    Comprehensive Enterprise SQA and Defensive Security Test Suite.
    Validates OWASP Top 10 defenses, RBAC authorization boundaries,
    injection mitigations, rate limiting, and secure file handling.
    """
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config['TESTING'] = True

    def setUp(self):
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()
        # Reset rate limiting state before each test
        reset_rate_limit("login_127.0.0.1")
        reset_rate_limit("register_127.0.0.1")

    def tearDown(self):
        self.app_context.pop()

    def get_token(self, email, password='Password123!'):
        res = self.client.post('/api/auth/login', json={'email': email, 'password': password})
        if res.status_code == 200:
            return res.get_json().get('access_token')
        return None

    def auth_headers(self, token):
        return {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

    # ══════════════════════════════════════════════════════════════════════════
    # TEST SUITE 1: HTTP SECURITY HEADERS (OWASP Security Misconfiguration)
    # ══════════════════════════════════════════════════════════════════════════
    def test_01_http_security_headers_present(self):
        print("\n[SQA-SEC-01] Validating HTTP Security Headers...")
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)

        # 1. Clickjacking defense
        self.assertEqual(res.headers.get('X-Frame-Options'), 'DENY')
        # 2. MIME sniffing defense
        self.assertEqual(res.headers.get('X-Content-Type-Options'), 'nosniff')
        # 3. Content Security Policy
        csp = res.headers.get('Content-Security-Policy', '')
        self.assertIn("default-src 'self'", csp)
        self.assertIn("object-src 'none'", csp)
        self.assertIn("frame-ancestors 'none'", csp)
        # 4. Referrer Policy
        self.assertEqual(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin')
        # 5. Permissions Policy
        self.assertIn('geolocation=()', res.headers.get('Permissions-Policy', ''))

        # 6. Cache Control on API routes
        api_res = self.client.get('/api/health')
        self.assertIn('no-store', api_res.headers.get('Cache-Control', ''))
        print("  ✓ PASS: All HTTP security headers enforced correctly.")

    # ══════════════════════════════════════════════════════════════════════════
    # TEST SUITE 2: BRUTE-FORCE DEFENSE & RATE LIMITING
    # ══════════════════════════════════════════════════════════════════════════
    def test_02_login_brute_force_rate_limiting(self):
        print("\n[SQA-SEC-02] Testing Login Brute Force Throttling & Lockout Policies...")
        # 1. Admin lockout test: 5 failed attempts -> 10-minute lockout
        for attempt in range(1, 5):
            res = self.client.post('/api/auth/login', json={
                'email': 'admin@internhub.com',
                'password': 'WrongPassword123!'
            })
            self.assertEqual(res.status_code, 401)
            data = res.get_json()
            expected_left = 5 - attempt
            self.assertEqual(data.get('attempts_left'), expected_left)
            self.assertIn('10-minute security lock', data.get('error', ''))

        # 5th failed attempt: Admin must be locked out for 10 minutes (429)
        lock_res = self.client.post('/api/auth/login', json={
            'email': 'admin@internhub.com',
            'password': 'WrongPassword123!'
        })
        self.assertEqual(lock_res.status_code, 429)
        lock_data = lock_res.get_json()
        self.assertTrue(lock_data.get('account_locked'))
        self.assertEqual(lock_data.get('remaining_minutes'), 10)
        self.assertIn('Account locked for 10 minutes', lock_data.get('error', ''))

        # Subsequent attempt while locked
        locked_res = self.client.post('/api/auth/login', json={
            'email': 'admin@internhub.com',
            'password': 'WrongPassword123!'
        })
        self.assertEqual(locked_res.status_code, 429)
        self.assertTrue(locked_res.get_json().get('account_locked'))

        # Reset admin account for zero pollution
        admin_user = User.query.filter_by(email='admin@internhub.com').first()
        admin_user.failed_login_attempts = 0
        admin_user.locked_until = None
        db.session.commit()

        # 2. Intern lockout test: 3 failed attempts -> 30-minute lockout
        for attempt in range(1, 3):
            res = self.client.post('/api/auth/login', json={
                'email': 'alex.intern@example.com',
                'password': 'WrongPassword123!'
            })
            self.assertEqual(res.status_code, 401)
            data = res.get_json()
            self.assertEqual(data.get('attempts_left'), 3 - attempt)
            self.assertIn('30-minute security lock', data.get('error', ''))

        intern_lock_res = self.client.post('/api/auth/login', json={
            'email': 'alex.intern@example.com',
            'password': 'WrongPassword123!'
        })
        self.assertEqual(intern_lock_res.status_code, 429)
        intern_lock_data = intern_lock_res.get_json()
        self.assertTrue(intern_lock_data.get('account_locked'))
        self.assertEqual(intern_lock_data.get('remaining_minutes'), 30)

        # Reset intern account for zero pollution
        intern_user = User.query.filter_by(email='alex.intern@example.com').first()
        intern_user.failed_login_attempts = 0
        intern_user.locked_until = None
        db.session.commit()

        print("  ✓ PASS: Admin (5 attempts / 10 mins) and Intern (3 attempts / 30 mins) lockout policies verified.")

    # ══════════════════════════════════════════════════════════════════════════
    # TEST SUITE 3: INJECTION DEFENSE (SQLi & XSS Sanitization)
    # ══════════════════════════════════════════════════════════════════════════
    def test_03_sqli_and_xss_injection_handling(self):
        print("\n[SQA-SEC-03] Testing SQL Injection and XSS Mitigations...")
        admin_token = self.get_token('admin@internhub.com')
        headers = self.auth_headers(admin_token)

        # SQL Injection attempt in login
        sqli_login = self.client.post('/api/auth/login', json={
            'email': "admin@internhub.com' OR '1'='1",
            'password': "' OR '1'='1"
        })
        self.assertIn(sqli_login.status_code, [400, 401])

        # SQL Injection attempt in search query
        sqli_search = self.client.get("/api/interns?search=' UNION SELECT 1,2,3--", headers=headers)
        self.assertEqual(sqli_search.status_code, 200)  # ORM parameterizes safely, no 500 error

        # XSS Payload in task creation
        intern = User.query.filter(User.role == 'intern', User.status.in_(['approved', 'completed'])).first()
        self.assertIsNotNone(intern)

        xss_task = self.client.post('/api/tasks', json={
            'title': "<script>alert('XSS-TEST')</script> Safe Task",
            'description': "<img src=x onerror=alert('XSS')>",
            'assigned_to_id': intern.id,
            'priority': 'medium'
        }, headers=headers)
        self.assertEqual(xss_task.status_code, 201)
        created_task = xss_task.get_json()['task']
        # Clean up
        Task.query.filter_by(id=created_task['id']).delete()
        db.session.commit()
        print("  ✓ PASS: SQL injection neutralized; XSS inputs safely parameterized without crashing.")

    # ══════════════════════════════════════════════════════════════════════════
    # TEST SUITE 4: FILE UPLOAD HARDENING & PATH TRAVERSAL DEFENSE
    # ══════════════════════════════════════════════════════════════════════════
    def test_04_file_upload_security_and_path_traversal(self):
        print("\n[SQA-SEC-04] Testing File Upload Security & Path Traversal...")
        intern_token = self.get_token('alex.intern@example.com')
        intern_headers = {'Authorization': f'Bearer {intern_token}'}

        intern_user = User.query.filter_by(email='alex.intern@example.com').first()
        task = Task.query.filter_by(assigned_to_id=intern_user.id).first()
        self.assertIsNotNone(task)

        # 1. Attempt to upload dangerous SVG / HTML file
        disallowed_files = [
            ('exploit.html', b'<html><script>alert("xss")</script></html>'),
            ('vector.svg', b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
            ('malware.exe', b'MZ900000000000000'),
            ('script.sh', b'#!/bin/bash\necho hacked')
        ]

        for fname, content in disallowed_files:
            data = {
                'status': 'in_progress',
                'intern_notes': 'Testing upload security',
                'attachment': (io.BytesIO(content), fname)
            }
            res = self.client.patch(f"/api/tasks/{task.id}/status", data=data,
                                    headers=intern_headers, content_type='multipart/form-data')
            self.assertEqual(res.status_code, 400, f"Expected 400 rejection for dangerous extension: {fname}")
            self.assertIn('Unsupported file format', res.get_json().get('error', ''))

        # 2. Allowed document upload (PDF)
        allowed_data = {
            'status': 'in_progress',
            'intern_notes': 'Clean project deliverable PDF',
            'attachment': (io.BytesIO(b'%PDF-1.4 clean test file content'), 'deliverable_notes.pdf')
        }
        res_ok = self.client.patch(f"/api/tasks/{task.id}/status", data=allowed_data,
                                   headers=intern_headers, content_type='multipart/form-data')
        self.assertEqual(res_ok.status_code, 200)

        # 3. Path Traversal defense on attachment download
        with self.app.app_context():
            saved_task = db.session.get(Task, task.id)
            uploaded_test_path = saved_task.attachment_path
            # Artificially test traversal path
            saved_task.attachment_path = "/static/uploads/../../../../etc/passwd"
            db.session.commit()

            traversal_res = self.client.get(f"/api/tasks/{task.id}/attachment", headers=intern_headers)
            self.assertEqual(traversal_res.status_code, 403)
            self.assertIn('Access denied', traversal_res.get_json().get('error', ''))

            # Restore original state and remove test file from disk
            if uploaded_test_path:
                disk_file = os.path.join(self.app.root_path, uploaded_test_path.lstrip('/'))
                if os.path.exists(disk_file):
                    os.remove(disk_file)
            saved_task.attachment_path = None
            saved_task.attachment_filename = None
            TaskProgressUpdate.query.filter_by(task_id=task.id, notes='Clean project deliverable PDF').delete()
            db.session.commit()

        print("  ✓ PASS: Malicious file types blocked; directory traversal strictly forbidden.")

    # ══════════════════════════════════════════════════════════════════════════
    # TEST SUITE 5: IDOR & HORIZONTAL PRIVILEGE ESCALATION DEFENSE
    # ══════════════════════════════════════════════════════════════════════════
    def test_05_idor_and_privilege_escalation(self):
        print("\n[SQA-SEC-05] Testing IDOR and Privilege Escalation...")
        intern1_token = self.get_token('alex.intern@example.com')
        intern1_headers = self.auth_headers(intern1_token)

        admin_token = self.get_token('admin@internhub.com')
        admin_headers = self.auth_headers(admin_token)

        # Find task assigned to an intern other than alex
        other_intern = User.query.filter(User.role == 'intern', User.email != 'alex.intern@example.com').first()
        self.assertIsNotNone(other_intern)

        created_temp_task = False
        other_task = Task.query.filter_by(assigned_to_id=other_intern.id).first()
        if not other_task:
            other_task = Task(title="Other Intern Task", assigned_to_id=other_intern.id,
                              created_by_id=2, status='pending', priority='medium')
            db.session.add(other_task)
            db.session.commit()
            created_temp_task = True

        # Intern 1 tries to update other intern's task status (IDOR Attack)
        idor_res = self.client.patch(f"/api/tasks/{other_task.id}/status", json={
            'status': 'completed',
            'intern_notes': 'Unauthorized tampering'
        }, headers=intern1_headers)
        self.assertEqual(idor_res.status_code, 403)
        self.assertIn('Permission denied', idor_res.get_json().get('error', ''))

        # Intern tries to access completion letters endpoint (Admin only)
        letters_res = self.client.get('/api/letters/my', headers=intern1_headers)
        self.assertEqual(letters_res.status_code, 403)

        # Intern tries to issue a letter
        issue_attempt = self.client.post('/api/letters', json={
            'intern_id': other_intern.id,
            'start_date': '2026-01-01',
            'completion_date': '2026-06-01'
        }, headers=intern1_headers)
        self.assertEqual(issue_attempt.status_code, 403)

        # Intern tries to approve an account
        approve_attempt = self.client.patch(f"/api/interns/{other_intern.id}/approve", headers=intern1_headers)
        self.assertEqual(approve_attempt.status_code, 403)

        if created_temp_task and other_task:
            Task.query.filter_by(id=other_task.id).delete()
            db.session.commit()

        print("  ✓ PASS: IDOR prevented; role boundaries strictly enforced.")

    # ══════════════════════════════════════════════════════════════════════════
    # TEST SUITE 6: PORTAL BOUNDARY ISOLATION
    # ══════════════════════════════════════════════════════════════════════════
    def test_06_portal_boundary_isolation(self):
        print("\n[SQA-SEC-06] Testing Portal Boundary Isolation...")
        # Intern attempts to log in via admin portal
        res1 = self.client.post('/api/auth/login', json={
            'email': 'alex.intern@example.com',
            'password': 'Password123!',
            'portal': 'admin'
        })
        self.assertEqual(res1.status_code, 403)
        self.assertIn('Intern accounts are not permitted to sign in to the Administrative Operations Portal', res1.get_json().get('error', ''))

        # Admin attempts to log in via intern portal
        res2 = self.client.post('/api/auth/login', json={
            'email': 'admin@internhub.com',
            'password': 'Password123!',
            'portal': 'intern'
        })
        self.assertEqual(res2.status_code, 403)
        self.assertIn('Administrator accounts cannot sign in from the Intern Portal', res2.get_json().get('error', ''))
        print("  ✓ PASS: Portal separation enforced bidirectionally.")

    # ══════════════════════════════════════════════════════════════════════════
    # TEST SUITE 7: PEER REVIEW GOVERNANCE FOR ADMIN ACCOUNTS
    # ══════════════════════════════════════════════════════════════════════════
    def test_07_admin_peer_approval_policy(self):
        print("\n[SQA-SEC-07] Testing Administrator Peer Approval Enforcement...")
        admin_token = self.get_token('admin@internhub.com')
        admin_headers = self.auth_headers(admin_token)

        test_email = "test.sqa.peeradmin@internhub.com"
        # Cleanup
        User.query.filter_by(email=test_email).delete()
        db.session.commit()

        # Admin creates new admin account
        create_res = self.client.post('/api/auth/create-admin', json={
            'full_name': 'SQA Peer Admin',
            'email': test_email,
            'password': 'Password123!',
            'department': 'Talent Operations'
        }, headers=admin_headers)
        self.assertEqual(create_res.status_code, 201)
        new_admin = create_res.get_json()['user']

        # Creator tries to approve their own account -> MUST be blocked (403)
        self_approve = self.client.patch(f"/api/interns/{new_admin['id']}/approve", headers=admin_headers)
        self.assertEqual(self_approve.status_code, 403)
        self.assertIn('Peer Approval Policy', self_approve.get_json().get('error', ''))

        # Different admin (Super Admin) approves -> SUCCESS (200)
        super_token = self.get_token('superadmin@internhub.com')
        super_headers = self.auth_headers(super_token)
        peer_approve = self.client.patch(f"/api/interns/{new_admin['id']}/approve", headers=super_headers)
        self.assertEqual(peer_approve.status_code, 200)

        # Cleanup
        User.query.filter_by(email=test_email).delete()
        db.session.commit()
        print("  ✓ PASS: Peer review approval policy verified.")

if __name__ == '__main__':
    unittest.main()
