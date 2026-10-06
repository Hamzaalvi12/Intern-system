from datetime import datetime, timezone
from app import create_app
from app.models import db, User, Task, Attendance, InternshipLetter, Message

def run_seed():
    print("🌱 Initializing core system accounts (without dummy data)...")
    db.create_all()

    # 1. Super Admin
    super_admin = User.query.filter_by(email='superadmin@internhub.com').first()
    if not super_admin:
        super_admin = User(
            email='superadmin@internhub.com',
            full_name='Chief Executive Administrator',
            role='super_admin',
            status='approved',
            phone='+1 (555) 019-9000',
            department='Executive Leadership'
        )
        super_admin.set_password('Password123!')
        super_admin.credential_id = 'BTC-ADM-0001'
        db.session.add(super_admin)
        db.session.commit()
        print("✅ Super Admin created: superadmin@internhub.com / Password123!")
    else:
        if not super_admin.credential_id or super_admin.credential_id.startswith('FSZ-') or super_admin.credential_id.startswith('DWS-'):
            super_admin.credential_id = 'BTC-ADM-0001'
            db.session.commit()
        print("ℹ️ Super Admin account confirmed.")

    # 2. Regular Admin
    admin_user = User.query.filter_by(email='admin@internhub.com').first()
    if not admin_user:
        admin_user = User(
            email='admin@internhub.com',
            full_name='Sarah Jenkins',
            role='admin',
            status='approved',
            credential_id='BTC-ADM-0002',
            phone='+1 (555) 018-8000',
            department='Operations',
            approved_by_id=super_admin.id,
            approval_date=datetime.now(timezone.utc)
        )
        admin_user.set_password('Password123!')
        db.session.add(admin_user)
        db.session.commit()
        print("✅ Regular Admin created: admin@internhub.com / Password123!")
    else:
        if not admin_user.credential_id or admin_user.credential_id.startswith('FSZ-') or admin_user.credential_id.startswith('DWS-'):
            admin_user.credential_id = 'BTC-ADM-0002'
            db.session.commit()
        print("ℹ️ Regular Admin account confirmed.")

    # 3. Approved Intern (Alex Rivera)
    intern_alex = User.query.filter_by(email='alex.intern@example.com').first()
    if not intern_alex:
        intern_alex = User(
            email='alex.intern@example.com',
            full_name='Alex Rivera',
            role='intern',
            status='approved',
            credential_id='BTC-2026-0004',
            phone='+1 (555) 012-3456',
            department='Software Engineering',
            university='Stanford University',
            approved_by_id=admin_user.id,
            approval_date=datetime.now(timezone.utc)
        )
        intern_alex.set_password('Password123!')
        db.session.add(intern_alex)
        db.session.commit()
        print("✅ Approved Intern created: alex.intern@example.com / Password123!")
    else:
        if not intern_alex.credential_id or intern_alex.credential_id.startswith('FSZ-') or intern_alex.credential_id.startswith('DWS-'):
            intern_alex.credential_id = 'BTC-2026-0004'
            db.session.commit()
        print("ℹ️ Approved Intern account confirmed.")

    # 4. Pending Intern (David Miller - for testing Admin approval workflow)
    intern_david = User.query.filter_by(email='david.pending@example.com').first()
    if not intern_david:
        intern_david = User(
            email='david.pending@example.com',
            full_name='David Miller',
            role='intern',
            status='pending',
            credential_id='BTC-2026-0001',
            phone='+1 (555) 014-9876',
            department='Data Science',
            university='MIT'
        )
        intern_david.set_password('Password123!')
        db.session.add(intern_david)
        db.session.commit()
        print("✅ Pending Intern created: david.pending@example.com / Password123!")
    else:
        if not intern_david.credential_id or intern_david.credential_id.startswith('FSZ-') or intern_david.credential_id.startswith('DWS-'):
            intern_david.credential_id = 'BTC-2026-0001'
            db.session.commit()
        print("ℹ️ Pending Intern account confirmed.")

    print("\n✨ Core database initialization completed cleanly (no dummy tasks, attendance, or letters seeded).")

if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        run_seed()
