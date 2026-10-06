from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from app.models import db, User, Task, Attendance, InternshipLetter, Message
from app.utils import admin_or_super_admin_required, super_admin_required, generate_intern_credential_id, intern_required

interns_bp = Blueprint('interns', __name__)

@interns_bp.route('', methods=['GET'])
@admin_or_super_admin_required
def get_interns(current_user):
    """
    Requirement 2: Admins can see all interns' account info.
    Supports filtering by status (pending, approved, rejected, all) and query search.
    """
    status_filter = request.args.get('status', 'all').strip().lower()
    search = request.args.get('search', '').strip()

    pending_admin_list = []

    if status_filter in ['approved', 'active']:
        query = User.query.filter_by(role='intern', status='approved')
    elif status_filter in ['completed', 'alumni']:
        query = User.query.filter_by(role='intern', status='completed')
    elif status_filter == 'pending':
        # Interns only for the intern directory list
        query = User.query.filter_by(role='intern', status='pending')

        # Also fetch pending admin account requests separately so interns and admins are distinct
        pending_admins_query = User.query.filter(User.role.in_(['admin', 'super_admin']), User.status == 'pending')
        if search:
            search_pat = f"%{search}%"
            pending_admins_query = pending_admins_query.filter(
                (User.full_name.ilike(search_pat)) |
                (User.email.ilike(search_pat)) |
                (User.department.ilike(search_pat))
            )
        pending_admins = pending_admins_query.order_by(User.created_at.desc()).all()
        for p_admin in pending_admins:
            p_data = p_admin.to_dict()
            if p_admin.created_by_id:
                creator = db.session.get(User, p_admin.created_by_id)
                p_data['created_by_name'] = creator.full_name if creator else 'Administrator'
            pending_admin_list.append(p_data)
    elif status_filter == 'rejected':
        query = User.query.filter(User.role.in_(['intern', 'admin']), User.status == 'rejected')
    else:
        # Total enrolled interns: approved (active) and completed (alumni). Pending & rejected are excluded!
        query = User.query.filter(User.role == 'intern', User.status.in_(['approved', 'completed']))

    if search:
        search_pattern = f"%{search}%"
        query = query.filter(
            (User.full_name.ilike(search_pattern)) |
            (User.email.ilike(search_pattern)) |
            (User.department.ilike(search_pattern)) |
            (User.university.ilike(search_pattern))
        )

    users = query.order_by(User.created_at.desc()).all()

    intern_list = []
    for user in users:
        user_data = user.to_dict()
        user_data['total_tasks'] = user.assigned_tasks.count()
        user_data['completed_tasks'] = user.assigned_tasks.filter_by(status='completed').count()
        user_data['attendance_days'] = user.attendances.count()
        # Letter count only for completed interns
        user_data['letters_count'] = user.letters.count() if user.status == 'completed' else 0
        if user.created_by_id:
            creator = db.session.get(User, user.created_by_id)
            user_data['created_by_name'] = creator.full_name if creator else 'Administrator'
        intern_list.append(user_data)

    # Total interns count strictly excludes pending approvals and rejected
    total_count = User.query.filter(User.role == 'intern', User.status.in_(['approved', 'completed'])).count()
    active_count = User.query.filter_by(role='intern', status='approved').count()
    completed_count = User.query.filter_by(role='intern', status='completed').count()
    pending_count = User.query.filter(User.status == 'pending').count()
    pending_interns_count = User.query.filter_by(role='intern', status='pending').count()
    pending_admins_count = User.query.filter(User.role.in_(['admin', 'super_admin']), User.status == 'pending').count()
    rejected_count = User.query.filter(User.role.in_(['intern', 'admin']), User.status == 'rejected').count()

    return jsonify({
        'interns': intern_list,
        'pending_admins': pending_admin_list,
        'counts': {
            'total': total_count,
            'active': active_count,
            'completed': completed_count,
            'alumni': completed_count,
            'pending': pending_count,
            'pending_interns': pending_interns_count,
            'pending_admins': pending_admins_count,
            'rejected': rejected_count,
            'filtered': len(intern_list)
        }
    }), 200


@interns_bp.route('/<int:intern_id>', methods=['GET'])
@admin_or_super_admin_required
def get_intern_details(current_user, intern_id):
    """
    Retrieve full profile, assigned projects/tasks, and activity details for a specific intern.
    """
    target_user = db.session.get(User, intern_id)
    if not target_user:
        return jsonify({'error': 'Account not found.'}), 404

    tasks = [t.to_dict() for t in target_user.assigned_tasks.order_by(Task.created_at.desc()).all()]
    attendances = [a.to_dict() for a in target_user.attendances.order_by(Attendance.date.desc()).limit(30).all()]
    letters = [l.to_dict() for l in target_user.letters.order_by(InternshipLetter.created_at.desc()).all()]

    user_data = target_user.to_dict()
    if target_user.created_by_id:
        creator = db.session.get(User, target_user.created_by_id)
        user_data['created_by_name'] = creator.full_name if creator else 'Administrator'

    return jsonify({
        'intern': user_data,
        'tasks': tasks,
        'attendance': attendances,
        'letters': letters
    }), 200


@interns_bp.route('/<int:intern_id>/approve', methods=['PATCH'])
@admin_or_super_admin_required
def approve_intern(current_user, intern_id):
    """
    Approve an intern or administrator registration request.
    Enforces peer approval for administrator accounts (creator cannot self-approve).
    """
    target_user = db.session.get(User, intern_id)
    if not target_user:
        return jsonify({'error': 'Account not found.'}), 404

    if target_user.status == 'approved':
        return jsonify({'message': f'Account {target_user.full_name} is already approved.', 'user': target_user.to_dict()}), 200

    # Peer Approval Policy for Administrator Accounts:
    # "new admin accout ki approval koi or admin ya super admin kr skta ha"
    if target_user.role in ('admin', 'super_admin'):
        # Super Admin has supreme governance authority and can approve any administrator request
        if current_user.role != 'super_admin':
            if target_user.created_by_id and target_user.created_by_id == current_user.id:
                return jsonify({
                    'error': 'Peer Approval Policy: You created this administrator account request. Another administrator or Super Admin must review and approve it from the Pending Approvals section.'
                }), 403

    target_user.status = 'approved'
    if not target_user.credential_id:
        target_user.credential_id = generate_intern_credential_id(target_user.role)
    target_user.approved_by_id = current_user.id
    target_user.approval_date = datetime.now(timezone.utc)
    target_user.rejection_reason = None

    db.session.commit()

    role_label = 'Administrator' if target_user.role in ('admin', 'super_admin') else 'Intern'
    return jsonify({
        'message': f'{role_label} account for "{target_user.full_name}" has been approved by {current_user.full_name}. They may now sign in.',
        'user': target_user.to_dict()
    }), 200


@interns_bp.route('/<int:intern_id>/reject', methods=['PATCH'])
@admin_or_super_admin_required
def reject_intern(current_user, intern_id):
    """
    Reject an intern or administrator registration request with an optional reason.
    """
    target_user = db.session.get(User, intern_id)
    if not target_user:
        return jsonify({'error': 'Account not found.'}), 404

    data = request.get_json() or {}
    reason = (data.get('reason') or '').strip()

    target_user.status = 'rejected'
    target_user.rejection_reason = reason if reason else 'Application rejected by administration.'
    target_user.approval_date = datetime.now(timezone.utc)
    target_user.approved_by_id = current_user.id

    db.session.commit()

    role_label = 'Administrator' if target_user.role in ('admin', 'super_admin') else 'Intern'
    return jsonify({
        'message': f'{role_label} application for "{target_user.full_name}" has been marked as rejected.',
        'user': target_user.to_dict()
    }), 200


@interns_bp.route('/<int:intern_id>/complete', methods=['PATCH'])
@admin_or_super_admin_required
def complete_internship(current_user, intern_id):
    """
    Requirement: Option when an active intern's internship is completed,
    they are graduated to completed internship / alumni.
    """
    intern = db.session.get(User, intern_id)
    if not intern or intern.role != 'intern':
        return jsonify({'error': 'Intern not found.'}), 404

    data = request.get_json() or {}
    completion_date_str = data.get('completion_date')
    if completion_date_str:
        try:
            intern.end_date = datetime.strptime(completion_date_str, '%Y-%m-%d').date()
        except ValueError:
            pass
    if not intern.end_date:
        intern.end_date = datetime.now(timezone.utc).date()

    intern.status = 'completed'
    db.session.commit()

    return jsonify({
        'message': f'Internship for {intern.full_name} has been marked as COMPLETED! They are now registered in Alumni & Graduates.',
        'intern': intern.to_dict()
    }), 200


@interns_bp.route('/<int:intern_id>/reactivate', methods=['PATCH'])
@admin_or_super_admin_required
def reactivate_intern(current_user, intern_id):
    """
    Reactivate a completed or rejected intern back to active intern status.
    """
    intern = db.session.get(User, intern_id)
    if not intern or intern.role != 'intern':
        return jsonify({'error': 'Intern not found.'}), 404

    intern.status = 'approved'
    db.session.commit()

    return jsonify({
        'message': f'Intern {intern.full_name} has been reactivated to Active Intern status.',
        'intern': intern.to_dict()
    }), 200


@interns_bp.route('/<int:intern_id>', methods=['DELETE'])
@admin_or_super_admin_required
def delete_intern(current_user, intern_id):
    """
    Permanently delete an intern account (or rejected account) and clean up records.
    - Super Admins can delete any intern account.
    - Admins and Super Admins can delete any rejected registration request (intern or admin).
    """
    intern = db.session.get(User, intern_id)
    if not intern:
        return jsonify({'error': 'Record not found.'}), 404

    if intern.role == 'super_admin':
        return jsonify({'error': 'Super Administrator accounts cannot be deleted.'}), 400

    # Role & Status permission checks:
    # 1. If user is rejected, both admin and super_admin can delete the record.
    # 2. If user is active/approved/completed, ONLY super_admin can delete them (and only interns).
    if intern.status != 'rejected':
        if current_user.role != 'super_admin':
            return jsonify({'error': 'Permission denied. Only Super Administrators can delete active or completed intern accounts.'}), 403
        if intern.role != 'intern':
            return jsonify({'error': 'Active administrator accounts must be deleted via Administrator Management.'}), 400

    intern_name = intern.full_name
    role_label = 'Administrator request' if intern.role == 'admin' else 'Intern account'

    # Clean up messages involving this intern
    Message.query.filter(
        (Message.sender_id == intern_id) | (Message.recipient_id == intern_id)
    ).delete(synchronize_session='fetch')

    # Defensive cleanup of any tasks or user approvals/creation references
    Task.query.filter_by(assigned_to_id=intern_id).delete(synchronize_session='fetch')
    Task.query.filter_by(created_by_id=intern_id).update({'created_by_id': current_user.id})
    InternshipLetter.query.filter_by(intern_id=intern_id).delete(synchronize_session='fetch')
    InternshipLetter.query.filter_by(issued_by_id=intern_id).update({'issued_by_id': current_user.id})
    Attendance.query.filter_by(intern_id=intern_id).delete(synchronize_session='fetch')

    User.query.filter_by(approved_by_id=intern_id).update({'approved_by_id': None})
    User.query.filter_by(created_by_id=intern_id).update({'created_by_id': None})

    db.session.delete(intern)
    db.session.commit()

    return jsonify({
        'message': f'{role_label} "{intern_name}" has been permanently deleted.',
        'deleted_id': intern_id
    }), 200


# ══════════════════════════════════════════════════════════════════════════
# INTERN WORKING SCHEDULE & LEAVE DAYS
# ══════════════════════════════════════════════════════════════════════════

ALL_WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

@interns_bp.route('/schedule/request', methods=['POST'])
@intern_required
def request_schedule(current_user):
    """
    Intern sets or requests update to their weekly schedule.
    Whichever days are selected are working days; unselected days are leave days.
    Initial request and subsequent updates require admin approval.
    """
    data = request.get_json() or {}
    days = data.get('working_days') or []
    notes = (data.get('notes') or '').strip()

    selected_days = [d for d in days if d in ALL_WEEK_DAYS]

    if not selected_days:
        return jsonify({'error': 'Please select at least one working day for your schedule.'}), 400

    formatted_days_str = ','.join(selected_days)
    current_user.proposed_working_days = formatted_days_str
    current_user.schedule_status = 'pending_approval'
    if notes:
        current_user.schedule_notes = notes

    db.session.commit()

    leave_days = [d for d in ALL_WEEK_DAYS if d not in selected_days]
    action_label = "change request" if current_user.working_days else "working schedule"
    return jsonify({
        'message': f'Weekly {action_label} ({len(selected_days)} working days, {len(leave_days)} leave days) submitted successfully! Awaiting administrator approval.',
        'user': current_user.to_dict()
    }), 200


@interns_bp.route('/schedules', methods=['GET'])
@admin_or_super_admin_required
def get_all_schedules(current_user):
    """
    Admin view of all interns' working schedules, leave days, and pending approval requests.
    """
    interns = User.query.filter_by(role='intern').order_by(User.full_name.asc()).all()
    schedules = []
    for intern in interns:
        w_days = [d.strip() for d in (intern.working_days or '').split(',') if d.strip()]
        p_days = [d.strip() for d in (intern.proposed_working_days or '').split(',') if d.strip()]
        l_days = [d for d in ALL_WEEK_DAYS if d not in w_days] if w_days else []
        schedules.append({
            'id': intern.id,
            'full_name': intern.full_name,
            'email': intern.email,
            'department': intern.department,
            'credential_id': intern.credential_id,
            'status': intern.status,
            'working_days': w_days,
            'leave_days': l_days,
            'proposed_working_days': p_days,
            'schedule_status': intern.schedule_status or 'not_set',
            'schedule_notes': intern.schedule_notes,
            'schedule_approved_at': intern.schedule_approved_at.isoformat() if intern.schedule_approved_at else None
        })

    return jsonify({
        'schedules': schedules,
        'total': len(schedules),
        'pending_requests': sum(1 for s in schedules if s['schedule_status'] == 'pending_approval')
    }), 200


@interns_bp.route('/<int:intern_id>/schedule/approve', methods=['PATCH'])
@admin_or_super_admin_required
def approve_intern_schedule(current_user, intern_id):
    """
    Admin approves an intern's requested working schedule.
    """
    intern = db.session.get(User, intern_id)
    if not intern or intern.role != 'intern':
        return jsonify({'error': 'Intern not found.'}), 404

    target_days = intern.proposed_working_days or intern.working_days
    if not target_days:
        return jsonify({'error': 'No schedule has been proposed by this intern.'}), 400

    intern.working_days = target_days
    intern.proposed_working_days = None
    intern.schedule_status = 'approved'
    intern.schedule_approved_by_id = current_user.id
    intern.schedule_approved_at = datetime.now(timezone.utc)

    db.session.commit()
    return jsonify({
        'message': f'Work schedule for {intern.full_name} has been approved by {current_user.full_name}.',
        'intern': intern.to_dict()
    }), 200


@interns_bp.route('/<int:intern_id>/schedule/reject', methods=['PATCH'])
@admin_or_super_admin_required
def reject_intern_schedule(current_user, intern_id):
    """
    Admin rejects an intern's schedule request.
    """
    intern = db.session.get(User, intern_id)
    if not intern or intern.role != 'intern':
        return jsonify({'error': 'Intern not found.'}), 404

    data = request.get_json() or {}
    reason = (data.get('reason') or '').strip()

    intern.schedule_status = 'rejected'
    intern.proposed_working_days = None
    if reason:
        intern.schedule_notes = f"Rejected: {reason}"

    db.session.commit()
    return jsonify({
        'message': f'Schedule request for {intern.full_name} has been rejected.',
        'intern': intern.to_dict()
    }), 200


@interns_bp.route('/<int:intern_id>/schedule', methods=['PUT'])
@admin_or_super_admin_required
def set_intern_schedule(current_user, intern_id):
    """
    Admin directly sets or overrides an intern's working schedule.
    """
    intern = db.session.get(User, intern_id)
    if not intern or intern.role != 'intern':
        return jsonify({'error': 'Intern not found.'}), 404

    data = request.get_json() or {}
    days = data.get('working_days') or []
    notes = (data.get('notes') or '').strip()

    selected_days = [d for d in days if d in ALL_WEEK_DAYS]

    if not selected_days:
        return jsonify({'error': 'Please select at least one working day.'}), 400

    intern.working_days = ','.join(selected_days)
    intern.proposed_working_days = None
    intern.schedule_status = 'approved'
    if notes:
        intern.schedule_notes = notes
    intern.schedule_approved_by_id = current_user.id
    intern.schedule_approved_at = datetime.now(timezone.utc)

    db.session.commit()
    return jsonify({
        'message': f'Work schedule for {intern.full_name} updated successfully to: {", ".join(selected_days)}.',
        'intern': intern.to_dict()
    }), 200


# ══════════════════════════════════════════════════════════════════════════
# DIRECT PASSWORD RESET FOR INTERNS (Admin Feature - No Old Password Required)
# ══════════════════════════════════════════════════════════════════════════

@interns_bp.route('/<int:intern_id>/reset-password', methods=['POST'])
@admin_or_super_admin_required
def admin_reset_intern_password(current_user, intern_id):
    """
    Feature: Admins can update/reset an intern's password directly if they forget it,
    WITHOUT requiring their old password.
    """
    intern = db.session.get(User, intern_id)
    if not intern:
        return jsonify({'error': 'Account not found.'}), 404

    if intern.role not in ('intern',):
        if current_user.role != 'super_admin' and intern.role in ('admin', 'super_admin'):
            return jsonify({'error': 'Only Super Admins can reset administrator passwords.'}), 403

    data = request.get_json() or {}
    new_password = (data.get('new_password') or '').strip()

    if not new_password or len(new_password) < 6:
        return jsonify({'error': 'New password must be at least 6 characters long.'}), 400

    intern.set_password(new_password)
    db.session.commit()

    return jsonify({
        'message': f'Password for {intern.full_name} ({intern.email}) has been successfully updated.',
        'intern_id': intern.id,
        'email': intern.email,
        'full_name': intern.full_name,
        'role': intern.role
    }), 200

