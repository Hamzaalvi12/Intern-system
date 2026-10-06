import re
import uuid
import io
import base64
from functools import wraps
from flask import jsonify, request
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
import qrcode
import barcode
from barcode.writer import SVGWriter
from app.models import User, db

import time
from collections import defaultdict

EMAIL_REGEX = r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$'

# In-memory sliding window rate limiter for brute-force defense
_rate_limit_records = defaultdict(list)

def is_rate_limited(key: str, max_requests: int = 15, window_seconds: int = 60) -> bool:
    """
    Sliding window rate limiter to mitigate brute-force and credential-stuffing attacks.
    Returns True if request count exceeds max_requests within window_seconds.
    """
    now = time.time()
    timestamps = _rate_limit_records[key]
    cutoff = now - window_seconds
    # Prune expired timestamps
    _rate_limit_records[key] = [t for t in timestamps if t > cutoff]
    
    if len(_rate_limit_records[key]) >= max_requests:
        return True
    
    _rate_limit_records[key].append(now)
    return False

def reset_rate_limit(key: str):
    """Clear rate limit tracking for a key upon successful authentication."""
    if key in _rate_limit_records:
        del _rate_limit_records[key]

def sanitize_string(value, max_length: int = 255) -> str:
    """Sanitize and clamp string inputs to prevent truncation or buffer overflow attacks."""
    if not value or not isinstance(value, str):
        return ""
    # Strip null bytes and control characters
    cleaned = value.replace('\x00', '').strip()
    return cleaned[:max_length]

def is_valid_email(email):
    if not email:
        return False
    return re.match(EMAIL_REGEX, email.strip()) is not None

def get_current_user():
    try:
        verify_jwt_in_request()
        user_id = get_jwt_identity()
        if not user_id:
            return None
        return db.session.get(User, int(user_id))
    except Exception:
        return None

def role_required(*allowed_roles):
    """
    Decorator to restrict access to specific roles.
    Checks:
    1. Valid JWT token
    2. User exists
    3. User approval status (interns must be approved)
    4. User role is in allowed_roles
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                verify_jwt_in_request()
            except Exception as e:
                return jsonify({'error': 'Authentication required. Invalid or missing token.', 'detail': str(e)}), 401

            user_id = get_jwt_identity()
            user = db.session.get(User, int(user_id)) if user_id else None

            if not user:
                return jsonify({'error': 'User not found or account removed.'}), 404

            # Accounts must be approved or completed (alumni) to perform authenticated actions
            if user.status not in ('approved', 'completed'):
                role_label = 'administrator' if user.role in ('admin', 'super_admin') else 'intern'
                return jsonify({
                    'error': f'Access denied. Your {role_label} account status is "{user.status}". Approval by an administrator is required.',
                    'status': user.status
                }), 403

            if user.role not in allowed_roles:
                return jsonify({
                    'error': f'Permission denied. This action requires one of the following roles: {list(allowed_roles)}.',
                    'your_role': user.role
                }), 403

            return fn(current_user=user, *args, **kwargs)
        return wrapper
    return decorator

def super_admin_required(fn):
    return role_required('super_admin')(fn)

def admin_or_super_admin_required(fn):
    return role_required('super_admin', 'admin')(fn)

def intern_required(fn):
    return role_required('intern')(fn)

def any_authenticated_user(fn):
    return role_required('super_admin', 'admin', 'intern')(fn)

def generate_letter_number():
    """
    Generates a clean, professional, unique serial number for the certificate.
    Format: BTC-YYYY-XXXX (e.g., BTC-2026-0001, BTC-2026-0002).
    Guarantees strict sequential uniqueness per intern.
    """
    from app.models import InternshipLetter
    import datetime
    current_year = datetime.datetime.now().year
    prefix = f"BTC-{current_year}-"
    try:
        letters = InternshipLetter.query.filter(InternshipLetter.letter_number.like(f"{prefix}%")).all()
        max_num = 0
        for l in letters:
            try:
                part = l.letter_number.split('-')[-1]
                val = int(part)
                if val > max_num:
                    max_num = val
            except Exception:
                continue
        next_num = max_num + 1
        while True:
            candidate = f"{prefix}{next_num:04d}"
            if not InternshipLetter.query.filter_by(letter_number=candidate).first():
                return candidate
            next_num += 1
    except Exception:
        return f"{prefix}{uuid.uuid4().hex[:6].upper()}"

def generate_intern_credential_id(role: str = 'intern') -> str:
    """
    Generates a permanent, unique credential ID for an intern (e.g. BTC-2026-0001)
    or administrator (e.g. BTC-ADM-0001).
    Guarantees strict sequential uniqueness per year in the database.
    """
    from app.models import User
    import datetime
    current_year = datetime.datetime.now().year

    if role in ('admin', 'super_admin'):
        prefix = "BTC-ADM-"
        try:
            users = User.query.filter(User.credential_id.like(f"{prefix}%")).all()
            max_num = 0
            for u in users:
                if not u.credential_id:
                    continue
                try:
                    part = u.credential_id.split('-')[-1]
                    val = int(part)
                    if val > max_num:
                        max_num = val
                except Exception:
                    continue
            next_num = max_num + 1
            while True:
                candidate = f"{prefix}{next_num:04d}"
                if not User.query.filter_by(credential_id=candidate).first():
                    return candidate
                next_num += 1
        except Exception:
            return f"{prefix}{uuid.uuid4().hex[:6].upper()}"
    else:
        prefix = f"BTC-{current_year}-"
        try:
            users = User.query.filter(User.credential_id.like(f"{prefix}%")).all()
            max_num = 0
            for u in users:
                if not u.credential_id:
                    continue
                try:
                    part = u.credential_id.split('-')[-1]
                    val = int(part)
                    if val > max_num:
                        max_num = val
                except Exception:
                    continue
            next_num = max_num + 1
            while True:
                candidate = f"{prefix}{next_num:04d}"
                if not User.query.filter_by(credential_id=candidate).first():
                    return candidate
                next_num += 1
        except Exception:
            return f"{prefix}{uuid.uuid4().hex[:6].upper()}"

def generate_qr_code_base64(data_url: str) -> str:
    """
    Generates a high-contrast, clean 2D QR code as a base64 PNG data URL.
    Scannable by all native smartphone cameras (iOS Camera, Android Camera, Google Lens).
    """
    try:
        qr = qrcode.QRCode(
            version=None,
            error_correction=qrcode.constants.ERROR_CORRECT_M,
            box_size=8,
            border=2,
        )
        qr.add_data(data_url)
        qr.make(fit=True)
        buf = io.BytesIO()
        qr.make_image(fill_color="#0b1528", back_color="#ffffff").save(buf, format="PNG")
        return f"data:image/png;base64,{base64.b64encode(buf.getvalue()).decode('utf-8')}"
    except Exception as e:
        return ""

def generate_barcode_svg(code_str: str) -> str:
    """
    Generates a clean, crisp 1D Code 128 barcode as inline SVG.
    Scannable by smartphone cameras and 1D/2D laser handheld barcode scanners.
    """
    try:
        code128 = barcode.get_barcode_class('code128')
        bc = code128(code_str, writer=SVGWriter())
        buf = io.BytesIO()
        bc.write(buf, options={'write_text': False, 'quiet_zone': 0.8, 'module_height': 8.5, 'module_width': 0.22})
        svg_str = buf.getvalue().decode('utf-8')
        if '<?xml' in svg_str:
            svg_str = svg_str.split('?>', 1)[-1].strip()
        m = re.search(r'width="([\d\.]+)mm"\s+height="([\d\.]+)mm"', svg_str)
        if m:
            w_mm = float(m.group(1))
            h_mm = float(m.group(2))
            svg_str = svg_str.replace(
                m.group(0),
                f'viewBox="0 0 {w_mm} {h_mm}" width="100%" height="100%" preserveAspectRatio="none"'
            )
        return svg_str
    except Exception as e:
        return ""
