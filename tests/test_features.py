import unittest
import json
import os
from app import create_app
from app.models import db, User, Task, Attendance, InternshipLetter

class TestNewFeatures(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = create_app()
        cls.app.config['TESTING'] = True

    def setUp(self):
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

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

    def test_01_html_fast_fill_removed_and_modal_present(self):
        print("\n--- TEST 1: Check HTML for Removal of Fast Fill Chips ---")
        res = self.client.get('/')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')
        self.assertNotIn("FAST FILL (INTERNS)", html)
        self.assertNotIn("FAST FILL (STAFF)", html)
        self.assertNotIn("quickFillCredentials", html)
        self.assertIn("modal-intern-details", html)
        self.assertIn("intern-modal-tasks-container", html)
        self.assertIn("modal-create-admin", html)
        print("PASS: Fast fill chips completely removed, modal-intern-details present in HTML.")

    def test_02_admin_login_and_intern_details_retrieval(self):
        print("\n--- TEST 2: Admin Login and Intern Details Retrieval ---")
        token = self.get_token('admin@internhub.com')
        self.assertIsNotNone(token)
        headers = self.auth_headers(token)

        # Get interns list
        interns_res = self.client.get('/api/interns?status=all', headers=headers)
        self.assertEqual(interns_res.status_code, 200)
        interns = interns_res.get_json()['interns']
        self.assertGreater(len(interns), 0)
        target = interns[0]
        print(f"Testing intern details for: {target['full_name']} (ID: {target['id']})")

        # Get details endpoint
        detail_res = self.client.get(f"/api/interns/{target['id']}", headers=headers)
        self.assertEqual(detail_res.status_code, 200)
        data = detail_res.get_json()
        self.assertIn('intern', data)
        self.assertIn('tasks', data)
        self.assertIn('attendance', data)
        self.assertIn('letters', data)
        print(f"PASS: Details returned: {len(data['tasks'])} tasks, {len(data['attendance'])} attendance entries, {len(data['letters'])} letters.")

    def test_03_admin_account_creation_and_peer_approval_flow(self):
        print("\n--- TEST 3: Admin Account Creation with Peer Review Flow ---")
        test_email = "peer.admin.unittest@internhub.com"

        # Clean up if existing
        existing = User.query.filter_by(email=test_email).first()
        if existing:
            db.session.delete(existing)
            db.session.commit()

        # Admin 1 logs in
        admin1_token = self.get_token('admin@internhub.com')
        self.assertIsNotNone(admin1_token)
        admin1_headers = self.auth_headers(admin1_token)

        admin1_user = User.query.filter_by(email='admin@internhub.com').first()

        # Admin 1 creates a new admin account
        create_res = self.client.post('/api/auth/create-admin', json={
            'full_name': 'Subordinate Ops Admin',
            'email': test_email,
            'password': 'Password123!',
            'phone': '+1-555-0987',
            'department': 'Operations'
        }, headers=admin1_headers)
        self.assertEqual(create_res.status_code, 201)
        created_admin = create_res.get_json()['admin']
        self.assertEqual(created_admin['status'], 'pending')
        self.assertEqual(created_admin['created_by_id'], admin1_user.id)
        print(f"PASS: Admin account created with status='pending', created_by_id={created_admin['created_by_id']}.")

        # Step 4: Pending admin cannot log in
        login_pending = self.client.post('/api/auth/login', json={
            'email': test_email,
            'password': 'Password123!'
        })
        self.assertEqual(login_pending.status_code, 403)
        self.assertIn('pending', login_pending.get_json()['error'].lower())
        print(f"PASS: Login blocked with 403 for pending admin account.")

        # Step 5: Creator admin attempts to approve (Must be rejected with 403)
        self_approve = self.client.patch(f"/api/interns/{created_admin['id']}/approve", headers=admin1_headers)
        self.assertEqual(self_approve.status_code, 403)
        self.assertIn('Peer Approval Policy', self_approve.get_json()['error'])
        print(f"PASS: Creator self-approval blocked with 403: {self_approve.get_json()['error']}")

        # Step 6: Different admin (superadmin) logs in and approves
        super_token = self.get_token('superadmin@internhub.com')
        self.assertIsNotNone(super_token)
        super_headers = self.auth_headers(super_token)

        peer_approve = self.client.patch(f"/api/interns/{created_admin['id']}/approve", headers=super_headers)
        self.assertEqual(peer_approve.status_code, 200)
        self.assertIn('approved', peer_approve.get_json()['message'].lower())
        print(f"PASS: Peer administrator approved successfully: {peer_approve.get_json()['message']}")

        # Step 7: Newly approved admin logs in successfully
        login_new = self.client.post('/api/auth/login', json={
            'email': test_email,
            'password': 'Password123!'
        })
        self.assertEqual(login_new.status_code, 200)
        self.assertEqual(login_new.get_json()['user']['status'], 'approved')
        print(f"PASS: Newly approved admin signed in successfully!")

        # Clean up test user
        new_user = User.query.filter_by(email=test_email).first()
        if new_user:
            db.session.delete(new_user)
            db.session.commit()
        print("Test user cleaned up.")

    def test_04_admin_create_task_with_attachment_and_intern_visibility(self):
        print("\n--- TEST 4: Admin Creates Task with Attachment and Intern Visibility ---")
        import io

        admin_token = self.get_token('admin@internhub.com')
        self.assertIsNotNone(admin_token)

        intern = User.query.filter_by(email='alex.intern@example.com').first()
        self.assertIsNotNone(intern)

        # 1. Admin creates task with attachment
        file_content = b"%PDF-1.4 Spec Brief: Build Authentication Module with JWT"
        task_data = {
            'title': 'Test Auth Feature with Spec File',
            'description': 'Follow the attached architecture specification carefully.',
            'priority': 'high',
            'due_date': '2026-10-15',
            'assigned_to_id': str(intern.id),
            'attachment': (io.BytesIO(file_content), 'architecture_spec.pdf')
        }

        headers = {'Authorization': f'Bearer {admin_token}'}
        task_id = None
        try:
            create_res = self.client.post('/api/tasks', data=task_data,
                                          headers=headers, content_type='multipart/form-data')
            self.assertEqual(create_res.status_code, 201)
            created_task = create_res.get_json()['task']
            self.assertEqual(created_task['admin_attachment_filename'], 'architecture_spec.pdf')
            self.assertTrue(created_task['admin_attachment_path'].startswith('/static/uploads/tasks/'))
            print(f"PASS: Task created with admin attachment: {created_task['admin_attachment_filename']}")

            task_id = created_task['id']

            # 2. Intern logs in and views their tasks
            intern_token = self.get_token('alex.intern@example.com')
            self.assertIsNotNone(intern_token)
            intern_headers = {'Authorization': f'Bearer {intern_token}'}

            intern_tasks_res = self.client.get('/api/tasks', headers=intern_headers)
            self.assertEqual(intern_tasks_res.status_code, 200)
            tasks_list = intern_tasks_res.get_json()['tasks']
            found = next((t for t in tasks_list if t['id'] == task_id), None)
            self.assertIsNotNone(found)
            self.assertEqual(found['admin_attachment_filename'], 'architecture_spec.pdf')
            self.assertEqual(found['admin_attachment_path'], created_task['admin_attachment_path'])
            print("PASS: Intern successfully sees the task and admin attachment file.")

            # 3. Intern downloads the admin attachment
            download_res = self.client.get(f'/api/tasks/{task_id}/admin-attachment', headers=intern_headers)
            self.assertEqual(download_res.status_code, 200)
            self.assertEqual(download_res.data, file_content)
            print("PASS: Intern successfully downloaded admin task attachment.")
        finally:
            # 4. Clean up test task
            if task_id:
                task_obj = db.session.get(Task, task_id)
                if task_obj:
                    if task_obj.admin_attachment_path:
                        disk_path = os.path.join(self.app.root_path, task_obj.admin_attachment_path.lstrip('/'))
                        if os.path.exists(disk_path):
                            os.remove(disk_path)
                    db.session.delete(task_obj)
                    db.session.commit()
            print("PASS: Test task cleaned up.")

    def test_05_super_admin_view_and_delete_sub_admin(self):
        print("\n--- TEST 5: Super Admin Views and Deletes Sub-Admin Accounts ---")
        super_token = self.get_token('superadmin@internhub.com')
        admin_token = self.get_token('admin@internhub.com')
        self.assertIsNotNone(super_token)
        self.assertIsNotNone(admin_token)

        super_headers = self.auth_headers(super_token)
        admin_headers = self.auth_headers(admin_token)

        # 1. Super Admin can view all sub-administrators (strictly role == 'admin', excluding Super Admin)
        res = self.client.get('/api/auth/admins', headers=super_headers)
        self.assertEqual(res.status_code, 200)
        admins_data = res.get_json().get('admins', [])
        self.assertTrue(len(admins_data) >= 1)
        for a in admins_data:
            self.assertEqual(a['role'], 'admin')
        print(f"PASS: Super admin lists strictly sub-admins only ({len(admins_data)} found, 0 super_admin in list).")

        # 2. Create a temporary sub-admin
        import uuid
        uid = uuid.uuid4().hex[:8]
        temp_admin = User(
            email=f'temp.subadmin.{uid}@internhub.com',
            full_name='Temp Test SubAdmin',
            role='admin',
            status='approved'
        )
        temp_admin.set_password('Password123!')
        db.session.add(temp_admin)
        db.session.commit()
        temp_admin_id = temp_admin.id

        # 3. Regular admin CANNOT delete another admin (Forbidden 403)
        res_forbidden = self.client.delete(f'/api/auth/admins/{temp_admin_id}', headers=admin_headers)
        self.assertEqual(res_forbidden.status_code, 403)
        print("PASS: Regular admin is forbidden (403) from deleting admin accounts.")

        # 4. Super admin cannot delete own account
        super_admin_user = User.query.filter_by(email='superadmin@internhub.com').first()
        res_self = self.client.delete(f'/api/auth/admins/{super_admin_user.id}', headers=super_headers)
        self.assertEqual(res_self.status_code, 400)
        print("PASS: Super admin self-deletion is properly blocked (400).")

        # 5. Super admin successfully deletes temporary sub-admin
        res_del = self.client.delete(f'/api/auth/admins/{temp_admin_id}', headers=super_headers)
        self.assertEqual(res_del.status_code, 200)
        self.assertIn('deleted', res_del.get_json().get('message', '').lower())

        # Verify record no longer exists in database
        check_user = db.session.get(User, temp_admin_id)
        self.assertIsNone(check_user)
        print("PASS: Super admin successfully deleted sub-admin account.")

    def test_06_super_admin_delete_intern(self):
        print("\n--- TEST 6: Super Admin Deletes Intern Account ---")
        import uuid
        uid = uuid.uuid4().hex[:8]
        super_token = self.get_token('superadmin@internhub.com')
        admin_token = self.get_token('admin@internhub.com')
        super_headers = self.auth_headers(super_token)
        admin_headers = self.auth_headers(admin_token)

        # 1. Create a temporary intern with an assigned task
        temp_intern = User(
            email=f'temp.intern.{uid}@example.com',
            full_name='Temp Deletable Intern',
            role='intern',
            status='approved',
            department='Engineering'
        )
        temp_intern.set_password('Password123!')
        db.session.add(temp_intern)
        db.session.commit()
        temp_intern_id = temp_intern.id

        admin_user = User.query.filter_by(email='admin@internhub.com').first()
        test_task = Task(
            title='Temporary Intern Task',
            description='Test task for cascading deletion check',
            assigned_to_id=temp_intern_id,
            created_by_id=admin_user.id,
            status='in_progress',
            priority='medium'
        )
        db.session.add(test_task)
        db.session.commit()
        test_task_id = test_task.id

        # 2. Regular admin CANNOT delete intern (Forbidden 403)
        res_forbidden = self.client.delete(f'/api/interns/{temp_intern_id}', headers=admin_headers)
        self.assertEqual(res_forbidden.status_code, 403)
        print("PASS: Regular admin is forbidden (403) from deleting interns.")

        # 3. Super admin successfully deletes intern
        res_del = self.client.delete(f'/api/interns/{temp_intern_id}', headers=super_headers)
        self.assertEqual(res_del.status_code, 200)
        self.assertIn('deleted', res_del.get_json().get('message', '').lower())

        # 4. Verify intern and cascaded tasks are deleted
        check_intern = db.session.get(User, temp_intern_id)
        self.assertIsNone(check_intern)
        check_task = db.session.get(Task, test_task_id)
        self.assertIsNone(check_task)
        print("PASS: Super admin successfully deleted intern and cascaded records.")

    def test_07_favicon_endpoint_and_html_links(self):
        print("\n--- TEST 7: Favicon Route and HTML Meta Links ---")
        # 1. Favicon endpoint returns 200
        res = self.client.get('/favicon.ico')
        self.assertEqual(res.status_code, 200)
        self.assertIn('image/', res.content_type)
        print(f"PASS: /favicon.ico returns 200 OK with content-type {res.content_type}.")

        # 2. Portal HTML includes favicon references
        index_res = self.client.get('/')
        self.assertEqual(index_res.status_code, 200)
        html = index_res.data.decode('utf-8')
        self.assertIn('/favicon.ico', html)
        self.assertIn('favicon.svg', html)
        print("PASS: Portal HTML includes FSZ favicon links.")

    def test_08_issued_letter_attachment_and_retrieval(self):
        print("\n--- TEST 8: Issued Letter Document File Attachment and Retrieval ---")
        import io
        import uuid
        admin_token = self.get_token('admin@internhub.com')
        admin_headers = {'Authorization': f'Bearer {admin_token}'}

        # Create temporary approved intern
        uid = uuid.uuid4().hex[:6]
        temp_intern = User(
            email=f'intern.letter.test.{uid}@example.com',
            full_name='Test Letter Recipient',
            role='intern',
            status='approved',
            department='Cloud Engineering'
        )
        temp_intern.set_password('Password123!')
        db.session.add(temp_intern)
        db.session.commit()
        intern_id = temp_intern.id

        letter_id = None
        try:
            # Admin issues letter with PDF attachment
            pdf_content = b"%PDF-1.4 Certificate of Accomplishment signed by Director"
            letter_data = {
                'intern_id': str(intern_id),
                'start_date': '2026-06-01',
                'completion_date': '2026-09-01',
                'department': 'Cloud Engineering',
                'performance_rating': 'Outstanding',
                'remarks': 'Exceptional dedication to cloud infrastructure.',
                'letter_file': (io.BytesIO(pdf_content), 'official_cert.pdf')
            }

            res = self.client.post('/api/letters', data=letter_data,
                                   headers=admin_headers, content_type='multipart/form-data')
            self.assertEqual(res.status_code, 201)
            res_data = res.get_json()
            letter_obj = res_data['letter']
            letter_id = letter_obj['id']

            self.assertEqual(letter_obj['document_filename'], 'official_cert.pdf')
            self.assertTrue(letter_obj['document_path'].startswith('/static/uploads/letters/'))
            self.assertTrue(letter_obj['letter_number'].startswith('BTC-'))
            print(f"PASS: Letter successfully issued with attachment: {letter_obj['document_filename']}, code: {letter_obj['letter_number']}")

            # Admin downloads attached letter document
            dl_res = self.client.get(f'/api/letters/{letter_id}/download', headers=admin_headers)
            self.assertEqual(dl_res.status_code, 200)
            self.assertEqual(dl_res.data, pdf_content)
            print("PASS: Admin successfully downloaded attached document.")
        finally:
            # Clean up temporary letter and intern
            if letter_id:
                let = db.session.get(InternshipLetter, letter_id)
                if let:
                    if let.document_path:
                        disk_path = os.path.join(self.app.root_path, let.document_path.lstrip('/'))
                        if os.path.exists(disk_path):
                            os.remove(disk_path)
                    db.session.delete(let)
            usr = db.session.get(User, intern_id)
            if usr:
                db.session.delete(usr)
            db.session.commit()
            print("PASS: Cleaned up temporary test letter and intern.")

    def test_09_multiple_interns_same_name_unique_letters(self):
        print("\n--- TEST 9: Same-Name Multiple Interns with Unique Validation Codes ---")
        import uuid
        admin_token = self.get_token('admin@internhub.com')
        admin_headers = {'Authorization': f'Bearer {admin_token}'}

        uid = uuid.uuid4().hex[:6]
        # Create two different interns with identical names but unique emails and IDs
        intern1 = User(
            email=f'same.name.1.{uid}@example.com',
            full_name='Muhammad Ali',
            role='intern',
            status='approved',
            department='Cybersecurity'
        )
        intern1.set_password('Password123!')
        intern2 = User(
            email=f'same.name.2.{uid}@example.com',
            full_name='Muhammad Ali',
            role='intern',
            status='approved',
            department='Data Science'
        )
        intern2.set_password('Password123!')
        db.session.add_all([intern1, intern2])
        db.session.commit()

        id1, id2 = intern1.id, intern2.id
        self.assertNotEqual(id1, id2)
        self.assertEqual(intern1.full_name, intern2.full_name)

        letter_id1 = None
        letter_id2 = None
        try:
            # Issue letter to intern 1
            res1 = self.client.post('/api/letters', json={
                'intern_id': id1,
                'start_date': '2026-05-01',
                'completion_date': '2026-08-01',
                'department': 'Cybersecurity'
            }, headers=admin_headers)
            self.assertEqual(res1.status_code, 201)
            code1 = res1.get_json()['letter']['letter_number']
            letter_id1 = res1.get_json()['letter']['id']

            # Issue letter to intern 2 (same name "Muhammad Ali" must NOT be blocked)
            res2 = self.client.post('/api/letters', json={
                'intern_id': id2,
                'start_date': '2026-06-01',
                'completion_date': '2026-09-01',
                'department': 'Data Science'
            }, headers=admin_headers)
            self.assertEqual(res2.status_code, 201)
            code2 = res2.get_json()['letter']['letter_number']
            letter_id2 = res2.get_json()['letter']['id']

            # Codes and IDs must be distinct
            self.assertNotEqual(code1, code2)
            self.assertNotEqual(letter_id1, letter_id2)
            self.assertTrue(code1.startswith('BTC-'))
            self.assertTrue(code2.startswith('BTC-'))
            print(f"PASS: Two interns named 'Muhammad Ali' successfully received distinct credentials: {code1} and {code2}")
        finally:
            # Clean up
            if letter_id1:
                l1 = db.session.get(InternshipLetter, letter_id1)
                if l1: db.session.delete(l1)
            if letter_id2:
                l2 = db.session.get(InternshipLetter, letter_id2)
                if l2: db.session.delete(l2)
            u1 = db.session.get(User, id1)
            u2 = db.session.get(User, id2)
            if u1: db.session.delete(u1)
            if u2: db.session.delete(u2)
            db.session.commit()
            print("PASS: Cleaned up same-name test interns and letters.")

    def test_10_admin_and_super_admin_update_profile(self):
        print("\n--- TEST 10: Admin and Super Admin Profile Updates (Name & Email) ---")
        super_token = self.get_token('superadmin@internhub.com')
        admin_token = self.get_token('admin@internhub.com')
        self.assertIsNotNone(super_token)
        self.assertIsNotNone(admin_token)

        super_headers = self.auth_headers(super_token)
        admin_headers = self.auth_headers(admin_token)

        # 1. Admin updates their name and phone
        res_admin = self.client.put('/api/auth/profile', json={
            'full_name': 'Sarah Jenkins Lead',
            'email': 'admin@internhub.com',
            'phone': '+1 (555) 999-1111',
            'department': 'Senior Talent Ops'
        }, headers=admin_headers)
        self.assertEqual(res_admin.status_code, 200)
        self.assertEqual(res_admin.get_json()['user']['full_name'], 'Sarah Jenkins Lead')
        self.assertEqual(res_admin.get_json()['user']['phone'], '+1 (555) 999-1111')
        print("PASS: Admin successfully updated profile name and contact.")

        # Revert admin name back
        self.client.put('/api/auth/profile', json={
            'full_name': 'Sarah Jenkins',
            'email': 'admin@internhub.com',
            'phone': '+1 (555) 018-8000',
            'department': 'Talent Operations'
        }, headers=admin_headers)

        # 2. Super Admin updates their name and department
        res_super = self.client.put('/api/auth/profile', json={
            'full_name': 'Master Super Admin Exec',
            'email': 'superadmin@internhub.com',
            'department': 'Executive Direction'
        }, headers=super_headers)
        self.assertEqual(res_super.status_code, 200)
        self.assertEqual(res_super.get_json()['user']['full_name'], 'Master Super Admin Exec')
        print("PASS: Super Admin successfully updated profile name and department.")

        # Revert super admin name back
        self.client.put('/api/auth/profile', json={
            'full_name': 'Master Super Admin',
            'email': 'superadmin@internhub.com',
            'department': 'Executive Management'
        }, headers=super_headers)

        # 3. Attempt to update email to one already used by someone else -> 400 Conflict
        res_duplicate = self.client.put('/api/auth/profile', json={
            'full_name': 'Sarah Jenkins',
            'email': 'superadmin@internhub.com'  # Already taken by superadmin
        }, headers=admin_headers)
        self.assertEqual(res_duplicate.status_code, 400)
        self.assertIn('already exists', res_duplicate.get_json()['error'])
        print("PASS: Duplicate email update was properly blocked with 400.")

    def test_11_unique_intern_credential_id_and_scannable_codes(self):
        print("\n--- TEST 11: Unique Intern Credential IDs and Scannable Verification System ---")
        import base64
        import io
        import uuid
        from PIL import Image
        from pyzbar.pyzbar import decode

        uid1 = uuid.uuid4().hex[:6]
        uid2 = uuid.uuid4().hex[:6]
        email1 = f"intern.cred1.{uid1}@example.com"
        email2 = f"intern.cred2.{uid2}@example.com"

        # Register intern 1
        res1 = self.client.post('/api/auth/register', json={
            'email': email1,
            'password': 'Password123!',
            'full_name': 'Hamza Khan',
            'department': 'Full Stack Engineering'
        })
        self.assertEqual(res1.status_code, 201)
        user1_data = res1.get_json()['user']
        cred_id1 = user1_data.get('credential_id')
        self.assertIsNotNone(cred_id1)
        self.assertTrue(cred_id1.startswith('BTC-'))

        # Register intern 2
        res2 = self.client.post('/api/auth/register', json={
            'email': email2,
            'password': 'Password123!',
            'full_name': 'Zainab Ahmed',
            'department': 'AI & Machine Learning'
        })
        self.assertEqual(res2.status_code, 201)
        user2_data = res2.get_json()['user']
        cred_id2 = user2_data.get('credential_id')
        self.assertIsNotNone(cred_id2)
        self.assertTrue(cred_id2.startswith('BTC-'))

        # Ensure unique credential IDs across different interns
        self.assertNotEqual(cred_id1, cred_id2)
        print(f"PASS: Two newly registered interns received unique credential IDs: {cred_id1} and {cred_id2}")

        # Admin approves intern 1 -> Credential ID is preserved and confirmed
        admin_token = self.get_token('admin@internhub.com')
        admin_headers = self.auth_headers(admin_token)
        appr_res = self.client.patch(f"/api/interns/{user1_data['id']}/approve", headers=admin_headers)
        self.assertEqual(appr_res.status_code, 200)
        appr_user = appr_res.get_json()['user']
        self.assertEqual(appr_user['credential_id'], cred_id1)
        self.assertEqual(appr_user['status'], 'approved')
        print(f"PASS: Admin approval confirmed unique intern credential ID: {cred_id1}")

        # Issue completion letter
        letter_res = self.client.post('/api/letters', json={
            'intern_id': user1_data['id'],
            'start_date': '2026-07-01',
            'completion_date': '2026-09-30',
            'department': 'Full Stack Engineering',
            'performance_rating': 'Outstanding'
        }, headers=admin_headers)
        self.assertEqual(letter_res.status_code, 201)
        letter_data = letter_res.get_json()['letter']
        letter_num = letter_data['letter_number']
        self.assertEqual(letter_data['intern_credential_id'], cred_id1)
        print(f"PASS: Issued letter correctly linked to unique intern credential ID {cred_id1} and certificate {letter_num}")

        # Test dynamic code asset renderer endpoint
        asset_res = self.client.get(f"/api/letters/render-code-assets?code={letter_num}")
        self.assertEqual(asset_res.status_code, 200)
        asset_json = asset_res.get_json()
        self.assertIn('qr_code_b64', asset_json)
        self.assertIn('barcode_svg', asset_json)
        self.assertIn(f"/verify/{letter_num}", asset_json['verify_url'])

        # Programmatically decode the generated QR code to verify scannability
        qr_b64 = asset_json['qr_code_b64'].split(',', 1)[1]
        qr_img = Image.open(io.BytesIO(base64.b64decode(qr_b64)))
        decoded_qr = decode(qr_img)
        self.assertTrue(len(decoded_qr) > 0)
        self.assertIn(letter_num, decoded_qr[0].data.decode('utf-8'))
        print(f"PASS: Scannable 2D QR Code successfully decoded with data: {decoded_qr[0].data.decode('utf-8')}")

        # Test Public Verification page HTTP 200
        verify_page_res = self.client.get(f"/verify/{letter_num}")
        self.assertEqual(verify_page_res.status_code, 200)
        self.assertIn(b"Official Credential Verified", verify_page_res.data)
        self.assertIn(cred_id1.encode('utf-8'), verify_page_res.data)
        self.assertIn(b"Hamza Khan", verify_page_res.data)
        print(f"PASS: Public verification portal displayed official student record for {letter_num} and {cred_id1}")

        # Clean up test accounts
        u1 = db.session.get(User, user1_data['id'])
        u2 = db.session.get(User, user2_data['id'])
        l1 = db.session.get(InternshipLetter, letter_data['id'])
        if l1: db.session.delete(l1)
        if u1: db.session.delete(u1)
        if u2: db.session.delete(u2)
        db.session.commit()
        print("PASS: Cleaned up test intern accounts and letter.")


if __name__ == '__main__':
    unittest.main()

