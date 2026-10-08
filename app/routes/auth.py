from datetime import datetime, date, timezone, timedelta
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token
from app.models import db, User, Task, InternshipLetter, Message
from app.utils import (
    is_valid_email,
    get_current_user,
    role_required,
    super_admin_required,
    admin_or_super_admin_required,
    any_authenticated_user,
    is_rate_limited,
    reset_rate_limit,
    sanitize_string,
    generate_intern_credential_id
)

auth_bp = Blueprint('auth', __name__)

@auth_bp.route('/register', methods=['POST'])
def register():
    """
    Intern Registration.
    Accounts are created with status='pending' and role='intern'.
    Interns cannot log in until an administrator approves their request.
    """
    client_ip = request.remote_addr or '127.0.0.1'
    if is_rate_limited(f"register_{client_ip}", max_requests=15, window_seconds=60):
        return jsonify({'error': 'Too many registration requests. Please wait a minute before trying again.'}), 429

    data = request.get_json() or {}
    
    email = sanitize_string(data.get('email'), 120).lower()
    password = data.get('password') or ''
    full_name = sanitize_string(data.get('full_name'), 100)
    phone = sanitize_string(data.get('phone'), 30)
    department = sanitize_string(data.get('department'), 100)
    university = sanitize_string(data.get('university'), 150)
    start_date_str = data.get('start_date')
    end_date_str = data.get('end_date')
    bio = sanitize_string(data.get('bio'), 1000)

    # Validation
    if not full_name:
        return jsonify({'error': 'Full name is required.'}), 400
    if not email or not is_valid_email(email):
        return jsonify({'error': 'A valid email address is required.'}), 400
    if not password or len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters long.'}), 400

    # Check if user already exists
    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'An account with this email already exists.'}), 409

    start_date = None
    end_date = None
    if start_date_str:
        try:
            start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid start_date format. Use YYYY-MM-DD.'}), 400
    if end_date_str:
        try:
            end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid end_date format. Use YYYY-MM-DD.'}), 400

    working_days_input = data.get('working_days')
    proposed_days_str = None
    if working_days_input:
        if isinstance(working_days_input, list):
            valid = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
            filtered = [d for d in working_days_input if d in valid]
            if filtered:
                proposed_days_str = ','.join(filtered)
        elif isinstance(working_days_input, str):
            proposed_days_str = working_days_input.strip()

    # Intern role and pending status are strictly enforced here
    # Assign a guaranteed unique intern credential ID upon registration
    credential_id = generate_intern_credential_id('intern')
    intern = User(
        email=email,
        full_name=full_name,
        role='intern',
        status='pending',
        credential_id=credential_id,
        phone=phone if phone else None,
        department=department if department else None,
        university=university if university else None,
        start_date=start_date,
        end_date=end_date,
        bio=bio if bio else None,
        proposed_working_days=proposed_days_str,
        schedule_status='pending_approval' if proposed_days_str else 'not_set'
    )
    intern.set_password(password)

    db.session.add(intern)
    db.session.commit()

    return jsonify({
        'message': 'Registration request submitted successfully! Your account is currently pending administrator approval before you can log in.',
        'user': intern.to_dict()
    }), 201


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Authenticate user and issue JWT.
    Enforces that intern accounts must be approved by an admin.
    """
    client_ip = request.remote_addr or '127.0.0.1'
    rate_key = f"login_{client_ip}"
    if is_rate_limited(rate_key, max_requests=10, window_seconds=60):
        return jsonify({
            'error': 'Too many login attempts. Please wait 60 seconds before trying again.',
            'rate_limited': True
        }), 429

    data = request.get_json() or {}
    email = sanitize_string(data.get('email'), 120).lower()
    password = data.get('password') or ''

    if not email or not password:
        return jsonify({'error': 'Email and password are required.'}), 400

    user = User.query.filter_by(email=email).first()

    now_utc = datetime.now(timezone.utc)

    # 1. Check if account is currently locked out
    if user and user.locked_until:
        locked_time = user.locked_until
        if locked_time.tzinfo is None:
            locked_time = locked_time.replace(tzinfo=timezone.utc)
        
        is_admin = user.role in ('admin', 'super_admin')
        threshold = 5 if is_admin else 3
        lock_mins = 10 if is_admin else 30

        if now_utc < locked_time:
            remaining_seconds = int((locked_time - now_utc).total_seconds())
            remaining_minutes = max(1, int((remaining_seconds + 59) // 60))
            return jsonify({
                'error': f'Account locked due to {threshold} failed attempts. Please wait {remaining_minutes} minute(s) before trying again.',
                'account_locked': True,
                'remaining_seconds': remaining_seconds,
                'remaining_minutes': remaining_minutes
            }), 429
        else:
            # Lockout expired: reset counters
            user.locked_until = None
            user.failed_login_attempts = 0
            db.session.commit()

    # 2. Check credentials
    if not user or not user.check_password(password):
        if user:
            user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
            is_admin = user.role in ('admin', 'super_admin')
            max_attempts = 5 if is_admin else 3
            lock_minutes = 10 if is_admin else 30

            if user.failed_login_attempts >= max_attempts:
                user.locked_until = now_utc + timedelta(minutes=lock_minutes)
                db.session.commit()
                return jsonify({
                    'error': f'Account locked for {lock_minutes} minutes due to {max_attempts} consecutive failed login attempts.',
                    'account_locked': True,
                    'remaining_seconds': lock_minutes * 60,
                    'remaining_minutes': lock_minutes
                }), 429
            else:
                attempts_left = max_attempts - user.failed_login_attempts
                db.session.commit()
                return jsonify({
                    'error': f'Invalid email or password. {attempts_left} attempt{"s" if attempts_left > 1 else ""} remaining before a {lock_minutes}-minute security lock.',
                    'attempts_left': attempts_left
                }), 401
        return jsonify({'error': 'Invalid email or password.'}), 401

    # 3. Successful password match: reset failed attempts
    if user.failed_login_attempts or user.locked_until:
        user.failed_login_attempts = 0
        user.locked_until = None
        db.session.commit()

    # Enforce strict portal boundary:
    portal = (data.get('portal') or '').strip().lower()
    if portal == 'admin' and user.role not in ('admin', 'super_admin'):
        return jsonify({
            'error': 'Access Denied: Intern accounts are not permitted to sign in to the Administrative Operations Portal. Please sign in via the Intern Portal.',
            'portal_error': True
        }), 403
    elif portal == 'intern' and user.role in ('admin', 'super_admin'):
        return jsonify({
            'error': 'Access Denied: Administrator accounts cannot sign in from the Intern Portal. Please use the Admin / Super Admin Portal.',
            'portal_error': True
        }), 403

    # Check approval status for both interns and administrators
    if user.status == 'pending':
        role_desc = 'administrator' if user.role in ('admin', 'super_admin') else 'intern'
        return jsonify({
            'error': f'Your {role_desc} account request is pending administrator approval. Please wait for an administrator to review and activate your account.',
            'account_status': 'pending'
        }), 403
    elif user.status == 'rejected':
        reason = user.rejection_reason or 'No specific reason provided.'
        return jsonify({
            'error': f'Your account registration request was rejected by an administrator. Reason: {reason}',
            'account_status': 'rejected'
        }), 403
    elif user.status not in ('approved', 'completed'):
        return jsonify({
            'error': f'Your account status is "{user.status}". Please contact administration.',
            'account_status': user.status
        }), 403

    # Authentication succeeded, reset rate limit for this IP
    reset_rate_limit(rate_key)

    # Generate JWT access token with user.id as identity (stringified for JWT compatibility)
    access_token = create_access_token(identity=str(user.id))

    return jsonify({
        'message': 'Login successful.',
        'access_token': access_token,
        'user': user.to_dict()
    }), 200


@auth_bp.route('/me', methods=['GET'])
@any_authenticated_user
def get_me(current_user):
    """
    Retrieve current authenticated user information.
    """
    return jsonify({
        'user': current_user.to_dict()
    }), 200


@auth_bp.route('/create-admin', methods=['POST'])
@admin_or_super_admin_required
def create_admin(current_user):
    """
    Requirement 2: Any admin can create another Admin account from the admin portal.
    The new account is created with status='pending' and requires approval by another
    administrator from the Pending Approvals section before it can sign in.
    """
    data = request.get_json() or {}
    email = sanitize_string(data.get('email'), 120).lower()
    password = data.get('password') or ''
    full_name = sanitize_string(data.get('full_name'), 100)
    phone = sanitize_string(data.get('phone'), 30)
    department = sanitize_string(data.get('department'), 100)

    if not full_name:
        return jsonify({'error': 'Admin full name is required.'}), 400
    if not email or not is_valid_email(email):
        return jsonify({'error': 'A valid email address is required.'}), 400
    if not password or len(password) < 6:
        return jsonify({'error': 'Password must be at least 6 characters long.'}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({'error': 'An account with this email already exists.'}), 409

    admin_credential_id = generate_intern_credential_id('admin')
    new_admin = User(
        email=email,
        full_name=full_name,
        role='admin',
        status='pending',  # Must be pending approval by another admin
        credential_id=admin_credential_id,
        phone=phone if phone else None,
        department=department if department else 'Talent Operations',
        created_by_id=current_user.id,
        approved_by_id=None,
        approval_date=None
    )
    new_admin.set_password(password)

    db.session.add(new_admin)
    db.session.commit()

    return jsonify({
        'message': f'Administrator account request for "{full_name}" submitted successfully with status PENDING. Another administrator must review and approve this account from the Pending Approvals section before it can sign in.',
        'user': new_admin.to_dict(),
        'admin': new_admin.to_dict()
    }), 201


@auth_bp.route('/admins', methods=['GET'])
@admin_or_super_admin_required
def list_admins(current_user):
    """
    List all subordinate administrator accounts (excluding Super Admin).
    """
    admins = User.query.filter_by(role='admin').order_by(User.created_at.desc()).all()
    return jsonify({
        'admins': [a.to_dict() for a in admins]
    }), 200


@auth_bp.route('/profile', methods=['PUT', 'PATCH', 'POST'])
@any_authenticated_user
def update_profile(current_user):
    """
    Allow administrators, super admins, and users to update their profile name, email, and contact info.
    Requirement: admin apna account ka name or email be change kr skta hayn including super admin.
    """
    data = request.get_json() or {}
    full_name = sanitize_string(data.get('full_name') or '', max_length=120)
    email = sanitize_string(data.get('email') or '', max_length=120).lower()
    phone = sanitize_string(data.get('phone') or '', max_length=30)
    department = sanitize_string(data.get('department') or '', max_length=100)

    if not full_name:
        return jsonify({'error': 'Full name is required.'}), 400

    if not email or not is_valid_email(email):
        return jsonify({'error': 'A valid email address is required.'}), 400

    # If email changed, check uniqueness across all users
    if email != current_user.email.lower():
        existing = User.query.filter(User.email == email, User.id != current_user.id).first()
        if existing:
            return jsonify({'error': f'An account with the email "{email}" already exists. Please choose a different email address.'}), 400
        current_user.email = email

    current_user.full_name = full_name
    if phone is not None:
        current_user.phone = phone if phone else None
    if department and current_user.role in ('admin', 'super_admin'):
        current_user.department = department

    db.session.commit()

    # Issue fresh access token with updated profile
    new_token = create_access_token(identity=str(current_user.id))

    return jsonify({
        'message': f'Profile updated successfully! Name: "{current_user.full_name}", Email: "{current_user.email}".',
        'user': current_user.to_dict(),
        'access_token': new_token
    }), 200


@auth_bp.route('/change-password', methods=['POST'])
@any_authenticated_user
def change_password(current_user):
    """
    Allow administrators and users to change/update their password.
    """
    data = request.get_json() or {}
    current_password = data.get('current_password') or ''
    new_password = data.get('new_password') or ''

    if not current_password or not new_password:
        return jsonify({'error': 'Current password and new password are required.'}), 400

    if not current_user.check_password(current_password):
        return jsonify({'error': 'Incorrect current password. Please try again.'}), 400

    if len(new_password) < 6:
        return jsonify({'error': 'New password must be at least 6 characters long.'}), 400

    if current_password == new_password:
        return jsonify({'error': 'New password must be different from current password.'}), 400

    current_user.set_password(new_password)
    current_user.failed_login_attempts = 0
    current_user.locked_until = None
    db.session.commit()

    return jsonify({'message': 'Your password has been updated successfully.'}), 200


@auth_bp.route('/admins/<int:admin_id>', methods=['DELETE'])
@admin_or_super_admin_required
def delete_admin(current_user, admin_id):
    """
    Permanently delete an administrator account or rejected administrator request.
    - Super Admins can delete any sub-administrator account.
    - Admins and Super Admins can delete rejected administrator registration requests.
    """
    admin = db.session.get(User, admin_id)
    if not admin or admin.role not in ('admin', 'super_admin'):
        return jsonify({'error': 'Administrator account not found.'}), 404

    if admin.id == current_user.id:
        return jsonify({'error': 'You cannot delete your own Administrator account.'}), 400

    if admin.role == 'super_admin':
        return jsonify({'error': 'Super Administrator accounts cannot be deleted directly.'}), 400

    if admin.status != 'rejected' and current_user.role != 'super_admin':
        return jsonify({'error': 'Permission denied. Only Super Administrators can delete active administrator accounts.'}), 403

    admin_name = admin.full_name

    # Safely reassign tasks created by this admin to the deleting Super Admin
    Task.query.filter_by(created_by_id=admin.id).update({'created_by_id': current_user.id})

    # Safely reassign letters issued by this admin to the deleting Super Admin
    InternshipLetter.query.filter_by(issued_by_id=admin.id).update({'issued_by_id': current_user.id})

    # Reassign created_by and approved_by references
    User.query.filter_by(created_by_id=admin.id).update({'created_by_id': current_user.id})
    User.query.filter_by(approved_by_id=admin.id).update({'approved_by_id': current_user.id})

    # Clean up messages involving this admin
    Message.query.filter(
        (Message.sender_id == admin.id) | (Message.recipient_id == admin.id)
    ).delete(synchronize_session='fetch')

    db.session.delete(admin)
    db.session.commit()

    return jsonify({
        'message': f'Administrator account "{admin_name}" has been permanently deleted.',
        'deleted_id': admin_id
    }), 200

