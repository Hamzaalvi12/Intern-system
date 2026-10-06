import unittest
import uuid
from datetime import date, timedelta
from app import create_app
from app.models import db, User, Task, Attendance, InternshipLetter, Message

class InternManagementSystemTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config['TESTING'] = True

    @classmethod
    def tearDownClass(cls):
        with cls.app.app_context():
            # Clean up only created test artifacts (test users and their direct records)
            test_users = User.query.filter(
                (User.email.like('test.intern.%')) | 
                (User.email.like('admin.sub.%')) |
                (User.email.like('hacker%'))
            ).all()
            for u in test_users:
                Task.query.filter((Task.assigned_to_id == u.id) | (Task.created_by_id == u.id)).delete()
                Attendance.query.filter_by(intern_id=u.id).delete()
                InternshipLetter.query.filter((InternshipLetter.intern_id == u.id) | (InternshipLetter.issued_by_id == u.id)).delete()
                Message.query.filter((Message.sender_id == u.id) | (Message.recipient_id == u.id)).delete()
                db.session.delete(u)

            # Note: DO NOT delete baseline users' tasks or data created by the user during manual testing.
            # Baseline users (alex, david) should retain all tasks and activities.
            db.session.commit()

    def setUp(self):
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def get_token(self, email, password='Password123!'):
        res = self.client.post('/api/auth/login', json={'email': email, 'password': password})
        data = res.get_json()
        if res.status_code == 200:
            return data.get('access_token')
        return None

    def auth_headers(self, token):
        return {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

    # 1. Intern Registration & Login Edge Cases
    def test_01_intern_registration_and_pending_login_block(self):
        uid = uuid.uuid4().hex[:6]
        test_email = f'test.intern.{uid}@example.com'
        reg_payload = {
            'email': test_email,
            'password': 'Password123!',
            'full_name': 'Unit Test Intern',
            'phone': '1234567890',
            'department': 'Cloud DevOps',
            'university': 'Tech University'
        }
        res = self.client.post('/api/auth/register', json=reg_payload)
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertEqual(data['user']['status'], 'pending')
        self.assertEqual(data['user']['role'], 'intern')

        # Intern tries to login before approval -> MUST be blocked
        login_res = self.client.post('/api/auth/login', json={
            'email': test_email,
            'password': 'Password123!'
        })
        self.assertEqual(login_res.status_code, 403)
        self.assertIn('pending administrator approval', login_res.get_json()['error'])

    # 2. Admin & Super Admin Permissions
    def test_02_super_admin_vs_regular_admin_creation(self):
        super_token = self.get_token('superadmin@internhub.com')
        admin_token = self.get_token('admin@internhub.com')
        intern_token = self.get_token('alex.intern@example.com')

        self.assertIsNotNone(super_token)
        self.assertIsNotNone(admin_token)
        self.assertIsNotNone(intern_token)

        # Super Admin creates a new admin -> SUCCESS (201)
        uid = uuid.uuid4().hex[:6]
        new_admin_email = f"admin.sub.{uid}@internhub.com"
        res = self.client.post('/api/auth/create-admin',
            json={
                'email': new_admin_email,
                'password': 'Password123!',
                'full_name': 'Secondary Admin',
                'department': 'HR Operations'
            },
            headers=self.auth_headers(super_token)
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.get_json()['user']['role'], 'admin')

        # Regular Admin can also create an admin account (created with pending status per Requirement 2)
        res_admin_attempt = self.client.post('/api/auth/create-admin',
            json={
                'email': f'admin.sub2.{uid}@internhub.com',
                'password': 'Password123!',
                'full_name': 'Secondary Admin Created By Regular Admin'
            },
            headers=self.auth_headers(admin_token)
        )
        self.assertEqual(res_admin_attempt.status_code, 201)
        self.assertEqual(res_admin_attempt.get_json()['user']['status'], 'pending')

        # Intern tries to create an admin -> FORBIDDEN (403)
        res_intern_attempt = self.client.post('/api/auth/create-admin',
            json={
                'email': f'hacker2.admin.{uid}@internhub.com',
                'password': 'Password123!',
                'full_name': 'Intern Attempting Admin'
            },
            headers=self.auth_headers(intern_token)
        )
        self.assertEqual(res_intern_attempt.status_code, 403)

        # Clean up temporary test admins to avoid leaving dummy data in DB
        User.query.filter(User.email.in_([f'admin.sub.{uid}@internhub.com', f'admin.sub2.{uid}@internhub.com'])).delete()
        db.session.commit()

    # 3. Admins view interns & Approve pending intern
    def test_03_admin_view_and_approve_intern(self):
        admin_token = self.get_token('admin@internhub.com')

        # Admin gets all interns
        res = self.client.get('/api/interns', headers=self.auth_headers(admin_token))
        self.assertEqual(res.status_code, 200)
        interns = res.get_json()['interns']
        self.assertTrue(len(interns) > 0)

        # Find or create a test pending intern
        test_email = f'test.intern.approval.{uuid.uuid4().hex[:6]}@example.com'
        test_intern = User(email=test_email, full_name='Test Pending Intern', role='intern', status='pending')
        test_intern.set_password('Password123!')
        db.session.add(test_intern)
        db.session.commit()

        # Approve test intern
        approve_res = self.client.patch(f'/api/interns/{test_intern.id}/approve', headers=self.auth_headers(admin_token))
        self.assertEqual(approve_res.status_code, 200)

        # Now test intern can log in!
        test_token = self.get_token(test_email)
        self.assertIsNotNone(test_token)

        # Clean up temporary test intern immediately
        db.session.delete(test_intern)
        db.session.commit()

    # 4. Tasks: Admin creates & assigns; Intern CANNOT create task
    def test_04_task_creation_and_intern_restriction(self):
        admin_token = self.get_token('admin@internhub.com')
        intern_token = self.get_token('alex.intern@example.com')
        alex = User.query.filter_by(email='alex.intern@example.com').first()

        # Admin creates task and assigns to Alex -> SUCCESS (201)
        res_admin = self.client.post('/api/tasks',
            json={
                'title': f'Build Payment Gateway Integration {uuid.uuid4().hex[:4]}',
                'description': 'Implement Stripe webhook handler',
                'priority': 'high',
                'due_date': (date.today() + timedelta(days=7)).isoformat(),
                'assigned_to_id': alex.id
            },
            headers=self.auth_headers(admin_token)
        )
        self.assertEqual(res_admin.status_code, 201)
        task_id = res_admin.get_json()['task']['id']

        # Intern tries to create a task -> FORBIDDEN (403)
        res_intern = self.client.post('/api/tasks',
            json={
                'title': 'Intern Rogue Task',
                'description': 'Intern trying to assign themselves a task',
                'assigned_to_id': alex.id
            },
            headers=self.auth_headers(intern_token)
        )
        self.assertEqual(res_intern.status_code, 403)
        self.assertIn('Permission denied', res_intern.get_json()['error'])

        # Intern updates status of their assigned task -> SUCCESS (200)
        status_res = self.client.patch(f'/api/tasks/{task_id}/status',
            json={
                'status': 'in_progress',
                'intern_notes': 'Working on local test environment'
            },
            headers=self.auth_headers(intern_token)
        )
        self.assertEqual(status_res.status_code, 200)
        self.assertEqual(status_res.get_json()['task']['status'], 'in_progress')

        # Intern updates status to completed
        status_res2 = self.client.patch(f'/api/tasks/{task_id}/status',
            json={
                'status': 'completed',
                'intern_notes': 'PR submitted and reviewed'
            },
            headers=self.auth_headers(intern_token)
        )
        self.assertEqual(status_res2.status_code, 200)
        self.assertEqual(status_res2.get_json()['task']['status'], 'completed')
        self.assertIsNotNone(status_res2.get_json()['task']['completed_at'])

        # Clean up test task immediately to avoid polluting database
        t_obj = db.session.get(Task, task_id)
        if t_obj:
            db.session.delete(t_obj)
            db.session.commit()

    # 5. Internship Letters: Only Admins can see completion letters, not Interns
    def test_05_internship_letters(self):
        admin_token = self.get_token('admin@internhub.com')
        intern_token = self.get_token('alex.intern@example.com')
        alex = User.query.filter_by(email='alex.intern@example.com').first()

        # Ensure clean state for Alex
        existing = InternshipLetter.query.filter_by(intern_id=alex.id).first()
        if existing:
            db.session.delete(existing)
            db.session.commit()

        # Admin issues completion letter -> 201 Created
        res = self.client.post('/api/letters',
            json={
                'intern_id': alex.id,
                'start_date': (date.today() - timedelta(days=90)).isoformat(),
                'completion_date': date.today().isoformat(),
                'department': 'Software Engineering',
                'performance_rating': 'Outstanding',
                'remarks': 'Exceptional dedication during the backend sprint.'
            },
            headers=self.auth_headers(admin_token)
        )
        self.assertEqual(res.status_code, 201)
        letter_id = res.get_json()['letter']['id']
        letter_number = res.get_json()['letter']['letter_number']

        # Duplicate issuance attempt without update_existing -> 409 Conflict with update prompt
        dup_res = self.client.post('/api/letters',
            json={
                'intern_id': alex.id,
                'start_date': (date.today() - timedelta(days=90)).isoformat(),
                'completion_date': date.today().isoformat(),
                'department': 'Software Engineering',
                'performance_rating': 'Excellent',
                'remarks': 'Duplicate attempt should be blocked and prompt to update.'
            },
            headers=self.auth_headers(admin_token)
        )
        self.assertEqual(dup_res.status_code, 409)
        dup_data = dup_res.get_json()
        self.assertTrue(dup_data.get('already_exists'))
        self.assertEqual(dup_data.get('letter_number'), letter_number)
        self.assertIn('Do you want to update it?', dup_data.get('error'))

        # Proactive intern check endpoint -> has_letter: True
        check_res = self.client.get(f'/api/letters/check-intern/{alex.id}', headers=self.auth_headers(admin_token))
        self.assertEqual(check_res.status_code, 200)
        self.assertTrue(check_res.get_json()['has_letter'])
        self.assertEqual(check_res.get_json()['letter']['letter_number'], letter_number)

        # Confirm update existing certificate -> 200 OK
        update_res = self.client.post('/api/letters',
            json={
                'intern_id': alex.id,
                'start_date': (date.today() - timedelta(days=90)).isoformat(),
                'completion_date': date.today().isoformat(),
                'department': 'Cloud Architecture',
                'performance_rating': 'Outstanding',
                'remarks': 'Updated accomplishment details.',
                'update_existing': True
            },
            headers=self.auth_headers(admin_token)
        )
        self.assertEqual(update_res.status_code, 200)
        self.assertTrue(update_res.get_json().get('updated'))
        self.assertEqual(update_res.get_json()['letter']['letter_number'], letter_number)
        self.assertEqual(update_res.get_json()['letter']['department'], 'Cloud Architecture')

        # Admin sees all letters -> SUCCESS (200)
        list_res = self.client.get('/api/letters', headers=self.auth_headers(admin_token))
        self.assertEqual(list_res.status_code, 200)
        self.assertTrue(len(list_res.get_json()['letters']) >= 1)

        # Requirement: ONLY ADMINS can see completion letters, NOT interns!
        # Intern attempting to view completion letters -> FORBIDDEN (403)
        intern_letters_res = self.client.get('/api/letters/my', headers=self.auth_headers(intern_token))
        self.assertEqual(intern_letters_res.status_code, 403)
        self.assertIn('Permission denied', intern_letters_res.get_json()['error'])

        # Intern attempting to view letter by ID -> FORBIDDEN (403)
        intern_detail_res = self.client.get(f'/api/letters/{letter_id}', headers=self.auth_headers(intern_token))
        self.assertEqual(intern_detail_res.status_code, 403)

        # Admin can view letter by ID -> SUCCESS (200)
        admin_detail_res = self.client.get(f'/api/letters/{letter_id}', headers=self.auth_headers(admin_token))
        self.assertEqual(admin_detail_res.status_code, 200)

        # Public verification endpoint
        verify_res = self.client.get(f'/api/letters/verify/{letter_number}')
        self.assertEqual(verify_res.status_code, 200)
        self.assertTrue(verify_res.get_json()['valid'])

    # 6. Intern Attendance
    def test_06_intern_attendance_and_duplicate_check(self):
        intern_token = self.get_token('alex.intern@example.com')
        
        # Intern checks in for today
        checkin_res = self.client.post('/api/attendance/check-in',
            json={'notes': 'Morning shift started', 'status': 'present'},
            headers=self.auth_headers(intern_token)
        )
        if checkin_res.status_code == 201:
            self.assertIn(checkin_res.get_json()['record']['status'], ['present', 'late'])
            
            # Duplicate check-in on the same day -> MUST FAIL (400)
            dup_res = self.client.post('/api/attendance/check-in',
                json={'notes': 'Second check in'},
                headers=self.auth_headers(intern_token)
            )
            self.assertEqual(dup_res.status_code, 400)
            self.assertIn('already checked in', dup_res.get_json()['error'])

            # Intern checks out
            checkout_res = self.client.post('/api/attendance/check-out',
                json={'notes': 'Finished daily tasks'},
                headers=self.auth_headers(intern_token)
            )
            self.assertEqual(checkout_res.status_code, 200)
            self.assertIsNotNone(checkout_res.get_json()['record']['check_out'])

    # 7. Messaging: Intern to Admin and Admin reply
    def test_07_intern_messages_and_admin_reply(self):
        intern_token = self.get_token('alex.intern@example.com')
        admin_token = self.get_token('admin@internhub.com')

        # Intern sends message to admin pool
        send_res = self.client.post('/api/messages',
            json={
                'subject': 'Request for Project Clarification',
                'body': 'Could you please confirm the deployment timeline?',
                'priority': 'normal'
            },
            headers=self.auth_headers(intern_token)
        )
        self.assertEqual(send_res.status_code, 201)
        msg_id = send_res.get_json()['data']['id']

        # Admin views messages
        admin_msgs_res = self.client.get('/api/messages', headers=self.auth_headers(admin_token))
        self.assertEqual(admin_msgs_res.status_code, 200)

        # Admin replies to message
        reply_res = self.client.post(f'/api/messages/{msg_id}/reply',
            json={'body': 'Deployment is scheduled for next Monday.'},
            headers=self.auth_headers(admin_token)
        )
        self.assertEqual(reply_res.status_code, 201)

    # 8. Password Change Test for Admins
    def test_08_admin_change_password(self):
        super_token = self.get_token('superadmin@internhub.com', 'Password123!')
        self.assertIsNotNone(super_token)

        # Attempt with wrong current password -> 400
        bad_res = self.client.post('/api/auth/change-password',
            json={'current_password': 'WrongPassword!', 'new_password': 'NewPassword123!'},
            headers=self.auth_headers(super_token)
        )
        self.assertEqual(bad_res.status_code, 400)
        self.assertIn('Incorrect current password', bad_res.get_json()['error'])

        # Attempt with valid current password -> 200
        ok_res = self.client.post('/api/auth/change-password',
            json={'current_password': 'Password123!', 'new_password': 'UpdatedPassword123!'},
            headers=self.auth_headers(super_token)
        )
        self.assertEqual(ok_res.status_code, 200)

        # Login with new password -> 200
        new_token = self.get_token('superadmin@internhub.com', 'UpdatedPassword123!')
        self.assertIsNotNone(new_token)

        # Reset back to standard Password123! for consistency
        self.client.post('/api/auth/change-password',
            json={'current_password': 'UpdatedPassword123!', 'new_password': 'Password123!'},
            headers=self.auth_headers(new_token)
        )

    # 9. Dedicated Letters Page for Admins
    def test_09_admin_letters_page(self):
        res = self.client.get('/admin/letters')
        self.assertEqual(res.status_code, 200)
        self.assertIn(b'Issued Internship Certificates', res.data)

if __name__ == '__main__':
    unittest.main()
