import zoneinfo
from datetime import datetime, date, time, timedelta, timezone
from flask import Blueprint, request, jsonify
from app.models import db, User, Attendance
from app.utils import intern_required, admin_or_super_admin_required, any_authenticated_user

attendance_bp = Blueprint('attendance', __name__)

PKT_TZ = zoneinfo.ZoneInfo("Asia/Karachi")

def get_current_pkt():
    return datetime.now(PKT_TZ)

@attendance_bp.route('/check-in', methods=['POST'])
@intern_required
def check_in(current_user):
    """
    Requirement 7: Intern marks attendance in exact Pakistan Standard Time (PKT, UTC+5).
    - Prevents duplicate check-in for the same date.
    - Check-in is permitted only on the intern's approved working days.
    """
    now_pkt = get_current_pkt()
    today_pkt = now_pkt.date()
    today_day_name = now_pkt.strftime("%A")

    # Scheduled leave check: Whichever days are unselected in the intern's approved schedule are their leave days
    working_days = [d.strip() for d in (current_user.working_days or '').split(',') if d.strip()]
    if working_days and today_day_name not in working_days:
        return jsonify({
            'error': f'Today ({today_day_name}) is your scheduled leave day. Attendance check-in is only permitted on your designated working days: {", ".join(working_days)}.',
            'is_leave_day': True,
            'today_day': today_day_name
        }), 400

    existing = Attendance.query.filter_by(intern_id=current_user.id, date=today_pkt).first()
    if existing:
        time_str = existing.check_in.strftime("%I:%M:%S %p") if existing.check_in else "earlier"
        return jsonify({
            'error': f'You have already checked in for today ({today_pkt.isoformat()}) at {time_str} (PKT).',
            'record': existing.to_dict()
        }), 400

    data = request.get_json() or {}
    notes = (data.get('notes') or '').strip()
    status_override = (data.get('status') or '').strip().lower()

    # Late detection based on Pakistan local time (after 10:30 AM PKT)
    auto_status = 'present'
    if status_override in ['present', 'late', 'wfh', 'half_day']:
        auto_status = status_override
    elif now_pkt.time() > time(10, 30):
        auto_status = 'late'

    # Store exact Pakistan Time
    record = Attendance(
        intern_id=current_user.id,
        date=today_pkt,
        check_in=now_pkt.replace(tzinfo=None),
        status=auto_status,
        notes=notes if notes else None
    )

    db.session.add(record)
    db.session.commit()

    time_display = record.check_in.strftime("%I:%M:%S %p")
    return jsonify({
        'message': f'Attendance check-in recorded successfully at {time_display} (PKT) as "{auto_status}".',
        'record': record.to_dict()
    }), 201


@attendance_bp.route('/check-out', methods=['POST'])
@intern_required
def check_out(current_user):
    """
    Intern check-out for today in exact Pakistan Standard Time (PKT), calculating total hours worked.
    After 10:00 PM PKT, check-out is automatically closed and marked as Missed Out Punch.
    """
    now_pkt = get_current_pkt()
    today_pkt = now_pkt.date()

    if now_pkt.time() >= time(22, 0):
        return jsonify({
            'error': 'Daily check-out window closed at 10:00 PM (PKT). Your shift has automatically been checked out at 07:00 PM by the system.'
        }), 400

    record = Attendance.query.filter_by(intern_id=current_user.id, date=today_pkt).first()
    if not record:
        return jsonify({
            'error': f'No check-in record found for today ({today_pkt.isoformat()}). You must check in first before checking out.'
        }), 400

    check_in_time = record.check_in
    checkout_naive = now_pkt.replace(tzinfo=None)
    record.check_out = checkout_naive

    duration_seconds = (checkout_naive - check_in_time).total_seconds()
    record.total_hours = max(0.0, round(duration_seconds / 3600.0, 2))

    data = request.get_json() or {}
    notes = (data.get('notes') or '').strip()
    if notes:
        record.notes = f"{record.notes} | Checkout: {notes}" if record.notes else notes

    db.session.commit()

    time_display = record.check_out.strftime("%I:%M:%S %p")
    return jsonify({
        'message': f'Checked out successfully at {time_display} (PKT). Total shift hours: {record.total_hours} hrs.',
        'record': record.to_dict()
    }), 200


@attendance_bp.route('/my', methods=['GET'])
@intern_required
def get_my_attendance(current_user):
    """
    Retrieve current intern's attendance records and statistics in Pakistan Time.
    """
    now_pkt = get_current_pkt()
    today_pkt = now_pkt.date()

    records = Attendance.query.filter_by(intern_id=current_user.id).order_by(Attendance.date.desc(), Attendance.check_in.desc()).all()
    today_record = Attendance.query.filter_by(intern_id=current_user.id, date=today_pkt).first()
    today_dict = today_record.to_dict() if today_record else None

    records_dict = [r.to_dict() for r in records]
    total_days = len(records_dict)
    total_hours = sum(r.get('total_hours') or 0.0 for r in records_dict)
    present_days = sum(1 for r in records_dict if r.get('status') in ['present', 'wfh'])
    late_days = sum(1 for r in records_dict if r.get('status') == 'late')
    missed_punch_days = sum(1 for r in records_dict if r.get('is_missed_punch'))

    working_days = [d.strip() for d in (current_user.working_days or '').split(',') if d.strip()]
    today_day_name = today_pkt.strftime('%A')
    is_scheduled_today = (today_day_name in working_days) if working_days else True
    all_week_days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    leave_days = [d for d in all_week_days if d not in working_days] if working_days else []

    has_active_shift = today_record is not None and today_record.check_out is None and not today_dict.get('is_missed_punch', False)

    return jsonify({
        'records': records_dict,
        'today': today_dict,
        'today_date': today_pkt.isoformat(),
        'today_day_name': today_day_name,
        'today_date_formatted': today_pkt.strftime('%b %d, %Y'),
        'is_scheduled_today': is_scheduled_today,
        'is_today_leave': not is_scheduled_today,
        'working_days': working_days,
        'leave_days': leave_days,
        'schedule_status': current_user.schedule_status or 'not_set',
        'server_time_pkt': now_pkt.strftime('%I:%M:%S %p'),
        'stats': {
            'total_days': total_days,
            'total_hours': round(total_hours, 2),
            'present_days': present_days,
            'late_days': late_days,
            'missed_punch_days': missed_punch_days,
            'has_checked_in_today': today_record is not None,
            'has_checked_out_today': today_record is not None and today_record.check_out is not None,
            'has_active_shift_today': has_active_shift,
            'is_today_missed_punch': today_dict.get('is_missed_punch', False) if today_dict else False
        }
    }), 200


@attendance_bp.route('', methods=['GET'])
@attendance_bp.route('/', methods=['GET'])
@attendance_bp.route('/all', methods=['GET'])
@admin_or_super_admin_required
def get_all_attendance(current_user):
    """
    Admin view of all intern attendance records with optional filtering in Pakistan Time.
    Supports filtering by intern_id, date, and text search across intern name, email, and notes.
    """
    intern_id = request.args.get('intern_id')
    date_str = request.args.get('date')
    search = (request.args.get('search') or '').strip()

    query = Attendance.query.join(User, Attendance.intern_id == User.id)

    if intern_id:
        try:
            query = query.filter(Attendance.intern_id == int(intern_id))
        except (ValueError, TypeError):
            pass

    if date_str:
        try:
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            query = query.filter(Attendance.date == target_date)
        except ValueError:
            return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD.'}), 400

    if search:
        search_pat = f"%{search}%"
        query = query.filter(
            (User.full_name.ilike(search_pat)) |
            (User.email.ilike(search_pat)) |
            (Attendance.notes.ilike(search_pat))
        )

    records = query.order_by(Attendance.date.desc(), Attendance.check_in.desc()).all()
    records_dict = [r.to_dict() for r in records]

    now_pkt = get_current_pkt()
    today_pkt = now_pkt.date()

    active_count = sum(1 for r in records_dict if not r.get('check_out_raw') and not r.get('is_missed_punch'))
    completed_count = sum(1 for r in records_dict if r.get('check_out_raw'))
    missed_count = sum(1 for r in records_dict if r.get('is_missed_punch'))
    total_hours = sum(r.get('total_hours') or 0.0 for r in records_dict)

    return jsonify({
        'records': records_dict,
        'total': len(records_dict),
        'stats': {
            'total': len(records_dict),
            'active': active_count,
            'completed': completed_count,
            'missed': missed_count,
            'total_hours': round(total_hours, 2)
        },
        'server_time_pkt': now_pkt.strftime('%I:%M:%S %p'),
        'server_date_pkt': today_pkt.isoformat()
    }), 200
