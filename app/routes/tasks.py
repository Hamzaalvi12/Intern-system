import os
import time
from datetime import datetime, timezone
from werkzeug.utils import secure_filename
from flask import Blueprint, request, jsonify, current_app, send_file
from app.models import db, User, Task, TaskProgressUpdate
from app.utils import (
    role_required,
    admin_or_super_admin_required,
    any_authenticated_user
)

tasks_bp = Blueprint('tasks', __name__)

ALLOWED_EXTENSIONS = {
    # Safe documents & spreadsheets
    'pdf', 'doc', 'docx', 'txt', 'rtf', 'csv', 'xlsx', 'xls', 'md',
    # Safe raster images (SVG excluded to eliminate XSS vectors)
    'png', 'jpg', 'jpeg', 'gif', 'webp',
    # Compressed archives & data
    'zip', 'tar', 'gz', '7z', 'rar', 'json'
}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@tasks_bp.route('', methods=['POST'])
@admin_or_super_admin_required
def create_task(current_user):
    """
    Requirement 3: Admin can create a task and assign to the interns.
    Requirement 4: Interns CANNOT create tasks (blocked by @admin_or_super_admin_required).
    Supports JSON or multipart/form-data with optional file attachment.
    """
    if request.is_json:
        data = request.get_json() or {}
    else:
        data = request.form.to_dict()

    title = (data.get('title') or '').strip()
    description = (data.get('description') or '').strip()
    priority = (data.get('priority') or 'medium').strip().lower()
    due_date_str = data.get('due_date')
    assigned_to_id = data.get('assigned_to_id')

    if not title:
        return jsonify({'error': 'Task title is required.'}), 400
    if not assigned_to_id:
        return jsonify({'error': 'Assigned intern (assigned_to_id) is required.'}), 400

    try:
        assigned_to_id = int(assigned_to_id)
    except (ValueError, TypeError):
        return jsonify({'error': 'Assigned intern (assigned_to_id) must be a valid ID.'}), 400

    # Verify intern exists and is approved
    intern = db.session.get(User, assigned_to_id)
    if not intern or intern.role != 'intern':
        return jsonify({'error': f'No intern found with ID {assigned_to_id}.'}), 404
    if intern.status not in ('approved', 'completed'):
        return jsonify({'error': f'Cannot assign tasks to intern "{intern.full_name}" because their status is "{intern.status}". Only approved interns can receive tasks.'}), 400

    if priority not in ['low', 'medium', 'high', 'urgent']:
        priority = 'medium'

    due_date = None
    if due_date_str:
        try:
            due_date = datetime.strptime(due_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid due_date format. Use YYYY-MM-DD.'}), 400

    task = Task(
        title=title,
        description=description if description else None,
        priority=priority,
        due_date=due_date,
        assigned_to_id=intern.id,
        created_by_id=current_user.id,
        status='pending'
    )

    # Handle optional file attachment uploaded during task assignment
    if 'attachment' in request.files:
        file = request.files['attachment']
        if file and file.filename:
            if not allowed_file(file.filename):
                return jsonify({
                    'error': 'Unsupported file format. Please upload documents, archives, images, or code files.'
                }), 400

            ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'dat'
            clean_base = secure_filename(file.filename.rsplit('.', 1)[0]) or 'brief'
            unique_filename = f"task_brief_{int(time.time())}_{clean_base}.{ext}"

            upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'tasks')
            os.makedirs(upload_folder, exist_ok=True)
            file_dest = os.path.join(upload_folder, unique_filename)
            file.save(file_dest)

            task.admin_attachment_filename = file.filename
            task.admin_attachment_path = f"/static/uploads/tasks/{unique_filename}"

    db.session.add(task)
    db.session.commit()

    return jsonify({
        'message': f'Task "{title}" assigned to {intern.full_name} successfully.',
        'task': task.to_dict()
    }), 201


@tasks_bp.route('', methods=['GET'])
@any_authenticated_user
def get_tasks(current_user):
    """
    List tasks:
    - If admin/super_admin: can view all tasks, or filter by intern_id, status, priority.
    - If intern: CAN ONLY view tasks assigned to themselves.
    """
    status = request.args.get('status', '').strip().lower()
    priority = request.args.get('priority', '').strip().lower()

    if current_user.role in ['admin', 'super_admin']:
        query = Task.query
        intern_id = request.args.get('intern_id')
        if intern_id:
            query = query.filter_by(assigned_to_id=intern_id)
    else:
        # Intern scoped strictly to their own assigned tasks
        query = Task.query.filter_by(assigned_to_id=current_user.id)

    if status == 'active':
        query = query.filter(Task.status.in_(['pending', 'in_progress']))
    elif status and status in ['pending', 'in_progress', 'completed']:
        query = query.filter_by(status=status)
    if priority and priority in ['low', 'medium', 'high', 'urgent']:
        query = query.filter_by(priority=priority)

    tasks = query.order_by(Task.created_at.desc()).all()
    return jsonify({
        'tasks': [t.to_dict() for t in tasks],
        'total': len(tasks)
    }), 200


@tasks_bp.route('/<int:task_id>', methods=['GET'])
@any_authenticated_user
def get_task(current_user, task_id):
    """
    Get task details. Interns can only view tasks assigned to them.
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    if current_user.role == 'intern' and task.assigned_to_id != current_user.id:
        return jsonify({'error': 'Access denied. You can only view tasks assigned to you.'}), 403

    return jsonify({'task': task.to_dict()}), 200


@tasks_bp.route('/<int:task_id>/status', methods=['PATCH'])
@any_authenticated_user
def update_task_status(current_user, task_id):
    """
    Requirement 5: Intern can update the status of the task to pending, in progress, or completed.
    Also accessible by admins.
    Edge Case: Intern can ONLY update status for tasks assigned to them!
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    # Security check for intern
    if current_user.role == 'intern' and task.assigned_to_id != current_user.id:
        return jsonify({'error': 'Permission denied. You can only update tasks assigned to you.'}), 403

    if request.is_json:
        data = request.get_json() or {}
        new_status = (data.get('status') or '').strip().lower()
        intern_notes = data.get('intern_notes')
        github_repo = data.get('github_repo')
    else:
        new_status = (request.form.get('status') or '').strip().lower()
        intern_notes = request.form.get('intern_notes')
        github_repo = request.form.get('github_repo')

    valid_statuses = ['pending', 'in_progress', 'completed']
    if new_status not in valid_statuses:
        return jsonify({
            'error': f'Invalid status "{new_status}". Allowed values: {valid_statuses}'
        }), 400

    task.status = new_status
    if intern_notes is not None:
        task.intern_notes = intern_notes.strip()

    if github_repo is not None:
        cleaned_repo = github_repo.strip()
        task.github_repo = cleaned_repo if cleaned_repo else None
    else:
        cleaned_repo = task.github_repo

    if new_status == 'completed':
        task.completed_at = datetime.now(timezone.utc)
    else:
        task.completed_at = None

    uploaded_filename = None
    uploaded_path = None

    # Handle optional file attachment upload
    if 'attachment' in request.files:
        file = request.files['attachment']
        if file and file.filename:
            if not allowed_file(file.filename):
                return jsonify({
                    'error': 'Unsupported file format. Please upload documents, archives, images, or code files.'
                }), 400

            ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else 'dat'
            clean_base = secure_filename(file.filename.rsplit('.', 1)[0]) or 'file'
            unique_filename = f"task_{task.id}_{int(time.time())}_{clean_base}.{ext}"

            upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'tasks')
            os.makedirs(upload_folder, exist_ok=True)
            file_dest = os.path.join(upload_folder, unique_filename)
            file.save(file_dest)

            uploaded_filename = file.filename
            uploaded_path = f"/static/uploads/tasks/{unique_filename}"
            task.attachment_filename = uploaded_filename
            task.attachment_path = uploaded_path

    # Record persistent daily progress log entry
    progress_update = TaskProgressUpdate(
        task_id=task.id,
        user_id=current_user.id,
        status=new_status,
        notes=intern_notes.strip() if intern_notes else (task.intern_notes or None),
        github_repo=cleaned_repo if cleaned_repo else None,
        attachment_filename=uploaded_filename,
        attachment_path=uploaded_path,
        created_at=datetime.now(timezone.utc)
    )
    db.session.add(progress_update)
    db.session.commit()

    return jsonify({
        'message': f'Task status updated to "{new_status}" and progress logged successfully.',
        'task': task.to_dict(),
        'progress_update': progress_update.to_dict()
    }), 200


@tasks_bp.route('/<int:task_id>/progress', methods=['GET'])
@any_authenticated_user
def get_task_progress_history(current_user, task_id):
    """
    Get all daily progress history updates for a specific task.
    Admins can view any task's progress. Interns can only view their own assigned task's progress.
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    if current_user.role == 'intern' and task.assigned_to_id != current_user.id:
        return jsonify({'error': 'Access denied. You can only view tasks assigned to you.'}), 403

    updates = task.progress_updates.all()
    return jsonify({
        'task_id': task.id,
        'task_title': task.title,
        'assigned_to_name': task.assignee.full_name if task.assignee else None,
        'current_status': task.status,
        'updates': [u.to_dict() for u in updates],
        'total': len(updates)
    }), 200


@tasks_bp.route('/<int:task_id>/progress/<int:update_id>', methods=['DELETE'])
@admin_or_super_admin_required
def delete_task_progress(current_user, task_id, update_id):
    """
    Allow Admin or Super Admin to delete any single progress update log from a task.
    Interns cannot delete progress logs.
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    progress_log = TaskProgressUpdate.query.filter_by(id=update_id, task_id=task.id).first()
    if not progress_log:
        return jsonify({'error': 'Progress log entry not found.'}), 404

    # Remove attached file if exists
    if progress_log.attachment_path:
        try:
            rel_path = progress_log.attachment_path.lstrip('/')
            full_path = os.path.join(current_app.root_path, rel_path)
            if os.path.isfile(full_path):
                os.remove(full_path)
        except Exception:
            pass

    db.session.delete(progress_log)
    db.session.flush()

    # Re-sync task deliverable fields with the latest remaining progress log (if any)
    remaining = TaskProgressUpdate.query.filter_by(task_id=task.id).order_by(TaskProgressUpdate.created_at.desc()).first()
    if remaining:
        task.intern_notes = remaining.notes
        task.github_repo = remaining.github_repo
        task.attachment_filename = remaining.attachment_filename
        task.attachment_path = remaining.attachment_path
        if remaining.status:
            task.status = remaining.status
    else:
        task.intern_notes = None
        task.github_repo = None
        task.attachment_filename = None
        task.attachment_path = None

    db.session.commit()
    return jsonify({
        'message': 'Progress log entry deleted successfully.',
        'task_id': task.id,
        'deleted_update_id': update_id
    }), 200


@tasks_bp.route('/<int:task_id>/attachment', methods=['GET'])
@any_authenticated_user
def download_task_attachment(current_user, task_id):
    """
    Download or stream task attachment (deliverable or admin task brief).
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    if current_user.role == 'intern' and task.assigned_to_id != current_user.id:
        return jsonify({'error': 'Access denied.'}), 403

    req_type = request.args.get('type', '').lower()
    if req_type in ['admin', 'brief', 'assignment']:
        att_path = task.admin_attachment_path
        att_name = task.admin_attachment_filename
    else:
        # Deliverable first, fallback to admin attachment
        if task.attachment_path:
            att_path = task.attachment_path
            att_name = task.attachment_filename
        else:
            att_path = task.admin_attachment_path
            att_name = task.admin_attachment_filename

    if not att_path or not att_name:
        return jsonify({'error': 'No attachment associated with this task.'}), 404

    upload_root = os.path.abspath(os.path.join(current_app.root_path, 'static', 'uploads'))
    rel_path = att_path.lstrip('/')
    abs_path = os.path.abspath(os.path.join(current_app.root_path, rel_path))

    if not abs_path.startswith(upload_root):
        return jsonify({'error': 'Access denied. Invalid attachment location.'}), 403

    if not os.path.exists(abs_path):
        return jsonify({'error': 'Attachment file missing from storage.'}), 404

    return send_file(abs_path, as_attachment=True, download_name=att_name)


@tasks_bp.route('/<int:task_id>/admin-attachment', methods=['GET'])
@any_authenticated_user
def download_admin_task_attachment(current_user, task_id):
    """
    Download or stream the administrator's assignment attachment.
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    if current_user.role == 'intern' and task.assigned_to_id != current_user.id:
        return jsonify({'error': 'Access denied.'}), 403

    if not task.admin_attachment_path or not task.admin_attachment_filename:
        return jsonify({'error': 'No administrator attachment associated with this task.'}), 404

    upload_root = os.path.abspath(os.path.join(current_app.root_path, 'static', 'uploads'))
    rel_path = task.admin_attachment_path.lstrip('/')
    abs_path = os.path.abspath(os.path.join(current_app.root_path, rel_path))

    if not abs_path.startswith(upload_root):
        return jsonify({'error': 'Access denied. Invalid attachment location.'}), 403

    if not os.path.exists(abs_path):
        return jsonify({'error': 'Attachment file missing from storage.'}), 404

    return send_file(abs_path, as_attachment=True, download_name=task.admin_attachment_filename)


@tasks_bp.route('/<int:task_id>', methods=['PUT'])
@admin_or_super_admin_required
def update_task(current_user, task_id):
    """
    Admin can update all details of a task (title, description, due date, priority, assigned intern).
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    data = request.get_json() or {}

    if 'title' in data and data['title'].strip():
        task.title = data['title'].strip()
    if 'description' in data:
        task.description = data['description'].strip()
    if 'priority' in data and data['priority'].lower() in ['low', 'medium', 'high', 'urgent']:
        task.priority = data['priority'].lower()
    if 'status' in data and data['status'].lower() in ['pending', 'in_progress', 'completed']:
        task.status = data['status'].lower()
        if task.status == 'completed':
            if not task.completed_at:
                task.completed_at = datetime.now(timezone.utc)
        else:
            task.completed_at = None
    if 'due_date' in data:
        if data['due_date']:
            try:
                task.due_date = datetime.strptime(data['due_date'], '%Y-%m-%d').date()
            except ValueError:
                return jsonify({'error': 'Invalid due_date format. Use YYYY-MM-DD.'}), 400
        else:
            task.due_date = None
    if 'assigned_to_id' in data:
        intern = db.session.get(User, data['assigned_to_id'])
        if not intern or intern.role != 'intern':
            return jsonify({'error': 'Assigned intern not found.'}), 404
        task.assigned_to_id = intern.id
    if 'github_repo' in data:
        cleaned_repo = (data['github_repo'] or '').strip()
        task.github_repo = cleaned_repo if cleaned_repo else None

    db.session.commit()

    return jsonify({
        'message': 'Task updated successfully.',
        'task': task.to_dict()
    }), 200


@tasks_bp.route('/<int:task_id>/extend', methods=['POST'])
@admin_or_super_admin_required
def extend_task_deadline(current_user, task_id):
    """
    Requirement 3: Admin can extend the due date of a completed task and return it back to in_progress status.
    Logs an audit progress update with administrator notes.
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    data = request.get_json() or {}
    new_due_date_str = (data.get('due_date') or '').strip()
    reason = (data.get('reason') or '').strip()

    if not new_due_date_str:
        return jsonify({'error': 'A new extended due date is required.'}), 400

    try:
        new_due_date = datetime.strptime(new_due_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid due date format. Use YYYY-MM-DD.'}), 400

    old_due_display = task.due_date.strftime('%b %d, %Y') if task.due_date else 'None'
    task.due_date = new_due_date
    task.status = 'in_progress'
    task.completed_at = None

    # Record persistent progress log update
    log_text = f"Deadline extended to {new_due_date.strftime('%b %d, %Y')} (was {old_due_display}). Task reopened as In Progress by {current_user.full_name}."
    if reason:
        log_text += f" Note: {reason}"

    progress_log = TaskProgressUpdate(
        task_id=task.id,
        user_id=current_user.id,
        status='in_progress',
        notes=log_text,
        created_at=datetime.now(timezone.utc)
    )
    db.session.add(progress_log)
    db.session.commit()

    return jsonify({
        'message': f'Task "{task.title}" reopened as In Progress with extended due date ({new_due_date.strftime("%b %d, %Y")}).',
        'task': task.to_dict()
    }), 200


@tasks_bp.route('/<int:task_id>', methods=['DELETE'])
@admin_or_super_admin_required
def delete_task(current_user, task_id):
    """
    Admin can delete a task.
    """
    task = db.session.get(Task, task_id)
    if not task:
        return jsonify({'error': 'Task not found.'}), 404

    db.session.delete(task)
    db.session.commit()

    return jsonify({'message': f'Task "{task.title}" deleted successfully.'}), 200
