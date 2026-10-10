from datetime import datetime, date, time, timezone
import zoneinfo
from werkzeug.security import generate_password_hash, check_password_hash
from app.database import db

def utc_now():
    return datetime.now(timezone.utc)

class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, index=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    full_name = db.Column(db.String(120), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='intern')  # 'super_admin', 'admin', 'intern'
    status = db.Column(db.String(20), nullable=False, default='pending')  # 'pending', 'approved', 'rejected'
    credential_id = db.Column(db.String(50), unique=True, index=True, nullable=True)
    phone = db.Column(db.String(30), nullable=True)
    department = db.Column(db.String(100), nullable=True)
    university = db.Column(db.String(150), nullable=True)
    start_date = db.Column(db.Date, nullable=True)
    end_date = db.Column(db.Date, nullable=True)
    bio = db.Column(db.Text, nullable=True)
    rejection_reason = db.Column(db.Text, nullable=True)
    
    approved_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    approval_date = db.Column(db.DateTime, nullable=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Working schedule (Dynamic days Mon-Sun; unselected days = leave days)
    working_days = db.Column(db.String(255), nullable=True)
    proposed_working_days = db.Column(db.String(255), nullable=True)
    schedule_status = db.Column(db.String(30), nullable=True, default='not_set')  # 'not_set', 'pending_approval', 'approved', 'rejected'
    schedule_shift = db.Column(db.String(100), nullable=True, default='09:00 AM - 05:00 PM')
    schedule_notes = db.Column(db.Text, nullable=True)
    schedule_approved_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    schedule_approved_at = db.Column(db.DateTime, nullable=True)
    
    # Account Security & Lockout Policy (3 failed attempts = 30-min lock)
    failed_login_attempts = db.Column(db.Integer, default=0, nullable=False)
    locked_until = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    # Relationships
    assigned_tasks = db.relationship('Task', foreign_keys='Task.assigned_to_id', backref='assignee', lazy='dynamic', cascade='all, delete-orphan')
    created_tasks = db.relationship('Task', foreign_keys='Task.created_by_id', backref='creator', lazy='dynamic')
    attendances = db.relationship('Attendance', backref='intern', lazy='dynamic', cascade='all, delete-orphan')
    letters = db.relationship('InternshipLetter', foreign_keys='InternshipLetter.intern_id', backref='intern', lazy='dynamic', cascade='all, delete-orphan')
    issued_letters = db.relationship('InternshipLetter', foreign_keys='InternshipLetter.issued_by_id', backref='issuer', lazy='dynamic')
    
    sent_messages = db.relationship('Message', foreign_keys='Message.sender_id', backref='sender', lazy='dynamic', cascade='all, delete-orphan')
    received_messages = db.relationship('Message', foreign_keys='Message.recipient_id', backref='recipient', lazy='dynamic')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self, include_sensitive=False):
        data = {
            'id': self.id,
            'email': self.email,
            'full_name': self.full_name,
            'role': self.role,
            'status': self.status,
            'credential_id': self.credential_id,
            'phone': self.phone,
            'department': self.department,
            'university': self.university,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'end_date': self.end_date.isoformat() if self.end_date else None,
            'bio': self.bio,
            'rejection_reason': self.rejection_reason,
            'approved_by_id': self.approved_by_id,
            'approval_date': self.approval_date.isoformat() if self.approval_date else None,
            'created_by_id': self.created_by_id,
            'working_days': [d.strip() for d in self.working_days.split(',') if d.strip()] if self.working_days else [],
            'working_days_raw': self.working_days,
            'proposed_working_days': [d.strip() for d in self.proposed_working_days.split(',') if d.strip()] if self.proposed_working_days else [],
            'proposed_working_days_raw': self.proposed_working_days,
            'schedule_status': self.schedule_status or 'not_set',
            'schedule_shift': self.schedule_shift or '09:00 AM - 05:00 PM',
            'schedule_notes': self.schedule_notes,
            'schedule_approved_by_id': self.schedule_approved_by_id,
            'schedule_approved_at': self.schedule_approved_at.isoformat() if self.schedule_approved_at else None,
            'failed_login_attempts': self.failed_login_attempts or 0,
            'locked_until': self.locked_until.isoformat() if self.locked_until else None,
            'is_locked': bool(self.locked_until and (self.locked_until if self.locked_until.tzinfo else self.locked_until.replace(tzinfo=timezone.utc)) > datetime.now(timezone.utc)),
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        return data


class Task(db.Model):
    __tablename__ = 'tasks'

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    status = db.Column(db.String(30), default='pending', nullable=False)  # 'pending', 'in_progress', 'completed'
    priority = db.Column(db.String(20), default='medium', nullable=False)  # 'low', 'medium', 'high', 'urgent'
    due_date = db.Column(db.Date, nullable=True)
    assigned_to_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    created_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    intern_notes = db.Column(db.Text, nullable=True)
    github_repo = db.Column(db.String(500), nullable=True)
    attachment_filename = db.Column(db.String(255), nullable=True)
    attachment_path = db.Column(db.String(500), nullable=True)
    admin_attachment_filename = db.Column(db.String(255), nullable=True)
    admin_attachment_path = db.Column(db.String(500), nullable=True)
    completed_at = db.Column(db.DateTime, nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    progress_updates = db.relationship('TaskProgressUpdate', backref='task', lazy='dynamic', cascade='all, delete-orphan', order_by='TaskProgressUpdate.created_at.desc()')

    def to_dict(self, include_updates=True):
        data = {
            'id': self.id,
            'title': self.title,
            'description': self.description,
            'status': self.status,
            'priority': self.priority,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'assigned_to_id': self.assigned_to_id,
            'assigned_to_name': self.assignee.full_name if self.assignee else None,
            'assigned_to_email': self.assignee.email if self.assignee else None,
            'assignee_status': self.assignee.status if self.assignee else None,
            'created_by_id': self.created_by_id,
            'created_by_name': self.creator.full_name if self.creator else None,
            'intern_notes': self.intern_notes,
            'github_repo': self.github_repo,
            'attachment_filename': self.attachment_filename,
            'attachment_path': self.attachment_path,
            'admin_attachment_filename': self.admin_attachment_filename,
            'admin_attachment_path': self.admin_attachment_path,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
        if include_updates:
            updates = [u.to_dict() for u in self.progress_updates.all()]
            data['progress_updates'] = updates
            data['progress_count'] = len(updates)
        return data


class TaskProgressUpdate(db.Model):
    __tablename__ = 'task_progress_updates'

    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    status = db.Column(db.String(30), nullable=False, default='in_progress')
    notes = db.Column(db.Text, nullable=True)
    github_repo = db.Column(db.String(500), nullable=True)
    attachment_filename = db.Column(db.String(255), nullable=True)
    attachment_path = db.Column(db.String(500), nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)

    user = db.relationship('User', foreign_keys=[user_id])

    def to_dict(self):
        return {
            'id': self.id,
            'task_id': self.task_id,
            'user_id': self.user_id,
            'user_name': self.user.full_name if self.user else 'User',
            'user_role': self.user.role if self.user else None,
            'status': self.status,
            'notes': self.notes,
            'github_repo': self.github_repo,
            'attachment_filename': self.attachment_filename,
            'attachment_path': self.attachment_path,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'created_at_formatted': self.created_at.strftime('%b %d, %Y • %I:%M %p') if self.created_at else None,
            'date_str': self.created_at.strftime('%Y-%m-%d') if self.created_at else None
        }


class Attendance(db.Model):
    __tablename__ = 'attendance'
    __table_args__ = (
        db.UniqueConstraint('intern_id', 'date', name='uq_intern_attendance_date'),
    )

    id = db.Column(db.Integer, primary_key=True)
    intern_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    date = db.Column(db.Date, nullable=False, default=date.today)
    check_in = db.Column(db.DateTime, nullable=False)
    check_out = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), default='present', nullable=False)  # 'present', 'late', 'half_day', 'wfh'
    notes = db.Column(db.Text, nullable=True)
    total_hours = db.Column(db.Float, nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)

    def to_dict(self):
        pkt_tz = zoneinfo.ZoneInfo("Asia/Karachi")
        now_pkt = datetime.now(pkt_tz)
        today_pkt = now_pkt.date()

        # Auto Punch Out: If checked in but not checked out, and date is in the past OR it is today after 10:00 PM PKT
        is_auto_punch = False
        auto_checkout_dt = None
        auto_hours = 0.0

        if self.check_out is None:
            if self.date < today_pkt or (self.date == today_pkt and now_pkt.time() >= time(22, 0)):
                is_auto_punch = True
                # Set auto punch out to 07:00:00 PM on shift date
                auto_checkout_dt = datetime.combine(self.date, time(19, 0))
                if self.check_in:
                    duration_sec = (auto_checkout_dt - self.check_in).total_seconds()
                    auto_hours = max(0.0, round(duration_sec / 3600.0, 2))

        check_in_fmt = self.check_in.strftime('%I:%M:%S %p') if self.check_in else None

        if self.check_out:
            check_out_fmt = self.check_out.strftime('%I:%M:%S %p')
            check_out_raw = self.check_out.strftime('%H:%M:%S')
            check_out_full = self.check_out.isoformat()
            display_status = self.status
            total_hours_val = self.total_hours
            notes_val = self.notes
        elif is_auto_punch:
            check_out_fmt = '07:00:00 PM'
            check_out_raw = '19:00:00'
            check_out_full = auto_checkout_dt.isoformat() if auto_checkout_dt else None
            display_status = self.status  # Keep 'present' or 'late'
            total_hours_val = auto_hours
            base_notes = f"{self.notes} | " if self.notes else ""
            notes_val = f"{base_notes}Auto punch by system"
        else:
            check_out_fmt = None
            check_out_raw = None
            check_out_full = None
            display_status = self.status
            total_hours_val = self.total_hours
            notes_val = self.notes

        day_name = self.date.strftime('%A') if self.date else (self.check_in.strftime('%A') if self.check_in else None)
        is_sunday = (self.date.weekday() == 6) if self.date else False

        return {
            'id': self.id,
            'intern_id': self.intern_id,
            'intern_name': self.intern.full_name if self.intern else None,
            'intern_email': self.intern.email if self.intern else None,
            'date': self.date.isoformat() if self.date else None,
            'date_formatted': self.date.strftime('%b %d, %Y') if self.date else None,
            'day_name': day_name,
            'is_sunday': is_sunday,
            'is_missed_punch': is_auto_punch,
            'is_auto_punch': is_auto_punch,
            'check_in': check_in_fmt,
            'check_in_raw': self.check_in.strftime('%H:%M:%S') if self.check_in else None,
            'check_in_full': self.check_in.isoformat() if self.check_in else None,
            'check_out': check_out_fmt,
            'check_out_raw': check_out_raw,
            'check_out_full': check_out_full,
            'status': display_status,
            'original_status': self.status,
            'notes': notes_val,
            'total_hours': total_hours_val,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class InternshipLetter(db.Model):
    __tablename__ = 'internship_letters'

    id = db.Column(db.Integer, primary_key=True)
    letter_number = db.Column(db.String(64), unique=True, index=True, nullable=False)
    intern_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    issued_by_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    issue_date = db.Column(db.Date, nullable=False, default=date.today)
    start_date = db.Column(db.Date, nullable=False)
    completion_date = db.Column(db.Date, nullable=False)
    title = db.Column(db.String(200), default='Certificate of Internship Completion', nullable=False)
    department = db.Column(db.String(100), nullable=False)
    performance_rating = db.Column(db.String(50), default='Outstanding', nullable=False)  # 'Outstanding', 'Excellent', 'Very Good', 'Satisfactory'
    remarks = db.Column(db.Text, nullable=True)
    guardian_name = db.Column(db.String(150), nullable=True)
    cnic_no = db.Column(db.String(50), nullable=True)
    duration_text = db.Column(db.String(100), default='TWO Months', nullable=True)
    projects_detail = db.Column(db.Text, nullable=True)
    organization_name = db.Column(db.String(150), default='DevWork Studio', nullable=True)
    sub_title = db.Column(db.String(150), default='Software Engineering Skill Development Platform', nullable=True)
    commendation_text = db.Column(db.Text, nullable=True)
    authorized_by = db.Column(db.String(150), default='DevWork Studio', nullable=True)
    signatory_title = db.Column(db.String(150), default='Admin Maheen', nullable=True)
    show_stamp = db.Column(db.Boolean, default=True, nullable=True)
    custom_logo_url = db.Column(db.String(300), nullable=True)
    logo_position = db.Column(db.String(50), default='left', nullable=True)  # 'left', 'center', 'right'
    custom_stamp_url = db.Column(db.String(300), nullable=True)
    stamp_x = db.Column(db.Integer, default=520, nullable=True)
    stamp_y = db.Column(db.Integer, default=740, nullable=True)
    document_filename = db.Column(db.String(255), nullable=True)
    document_path = db.Column(db.String(500), nullable=True)
    status = db.Column(db.String(20), default='issued', nullable=False)  # 'issued', 'revoked'
    created_at = db.Column(db.DateTime, default=utc_now)
    updated_at = db.Column(db.DateTime, default=utc_now, onupdate=utc_now)

    def to_dict(self):
        return {
            'id': self.id,
            'letter_number': self.letter_number,
            'intern_id': self.intern_id,
            'intern_credential_id': self.intern.credential_id if self.intern else None,
            'intern_name': self.intern.full_name if self.intern else None,
            'intern_email': self.intern.email if self.intern else None,
            'intern_university': self.intern.university if self.intern else None,
            'issued_by_id': self.issued_by_id,
            'issued_by_name': self.issuer.full_name if self.issuer else None,
            'issue_date': self.issue_date.isoformat() if self.issue_date else None,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'completion_date': self.completion_date.isoformat() if self.completion_date else None,
            'title': self.title,
            'department': self.department,
            'performance_rating': self.performance_rating,
            'remarks': self.remarks,
            'guardian_name': self.guardian_name,
            'cnic_no': self.cnic_no,
            'duration_text': self.duration_text or 'TWO Months',
            'projects_detail': self.projects_detail,
            'organization_name': self.organization_name or 'DevWork Studio',
            'sub_title': self.sub_title or 'Software Engineering Skill Development Platform',
            'commendation_text': self.commendation_text,
            'authorized_by': self.authorized_by or 'DevWork Studio',
            'signatory_title': self.signatory_title or 'Admin Maheen',
            'show_stamp': True if self.show_stamp is None else self.show_stamp,
            'custom_logo_url': self.custom_logo_url,
            'logo_position': self.logo_position or 'left',
            'custom_stamp_url': self.custom_stamp_url,
            'stamp_x': self.stamp_x if self.stamp_x is not None else 520,
            'stamp_y': self.stamp_y if self.stamp_y is not None else 740,
            'document_filename': self.document_filename,
            'document_path': self.document_path,
            'document_url': f"/api/letters/{self.id}/download" if self.document_filename else None,
            'status': self.status,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }


class Message(db.Model):
    __tablename__ = 'messages'

    id = db.Column(db.Integer, primary_key=True)
    sender_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    recipient_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)  # None = Admin Team pool
    subject = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=False)
    priority = db.Column(db.String(20), default='normal', nullable=False)  # 'low', 'normal', 'urgent'
    is_read = db.Column(db.Boolean, default=False, nullable=False)
    reply_to_id = db.Column(db.Integer, db.ForeignKey('messages.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=utc_now)

    replies = db.relationship('Message', backref=db.backref('parent', remote_side=[id]), lazy='dynamic')

    def to_dict(self, include_replies=True):
        data = {
            'id': self.id,
            'sender_id': self.sender_id,
            'sender_name': self.sender.full_name if self.sender else None,
            'sender_role': self.sender.role if self.sender else None,
            'sender_email': self.sender.email if self.sender else None,
            'recipient_id': self.recipient_id,
            'recipient_name': self.recipient.full_name if self.recipient else 'All Admins',
            'subject': self.subject,
            'body': self.body,
            'priority': self.priority,
            'is_read': self.is_read,
            'reply_to_id': self.reply_to_id,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
        if include_replies:
            data['replies'] = [r.to_dict(include_replies=False) for r in self.replies.order_by(Message.created_at.asc()).all()]
        return data
