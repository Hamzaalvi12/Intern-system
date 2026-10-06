import os
import time
from datetime import datetime, date
from flask import Blueprint, request, jsonify, current_app, send_file
from werkzeug.utils import secure_filename
from app.models import db, User, InternshipLetter
from app.utils import (
    admin_or_super_admin_required,
    intern_required,
    any_authenticated_user,
    generate_letter_number,
    generate_qr_code_base64,
    generate_barcode_svg
)

letters_bp = Blueprint('letters', __name__)

ALLOWED_LETTER_EXTS = {'pdf', 'doc', 'docx'}

def allowed_letter_doc(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_LETTER_EXTS

@letters_bp.route('', methods=['POST'])
@admin_or_super_admin_required
def issue_letter(current_user):
    """
    Requirement 6: Admin creates and assigns an internship letter to an intern on accomplishment of internship.
    Supports JSON or multipart/form-data with optional PDF/Word file attachment.
    """
    if request.is_json:
        data = request.get_json() or {}
    else:
        data = request.form.to_dict()

    intern_id = data.get('intern_id')
    start_date_str = data.get('start_date')
    completion_date_str = data.get('completion_date')
    department = (data.get('department') or '').strip()
    title = (data.get('title') or 'Certificate of Internship Completion').strip()
    performance_rating = (data.get('performance_rating') or 'Outstanding').strip()
    remarks = (data.get('remarks') or '').strip()

    if not intern_id:
        return jsonify({'error': 'Intern ID (intern_id) is required.'}), 400

    try:
        intern_id = int(intern_id)
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid intern ID.'}), 400

    intern = db.session.get(User, intern_id)
    if not intern or intern.role != 'intern':
        return jsonify({'error': f'Intern with ID {intern_id} not found.'}), 404
    if intern.status not in ('approved', 'completed'):
        return jsonify({'error': f'Cannot issue completion letter to unapproved intern "{intern.full_name}".'}), 400

    if not start_date_str or not completion_date_str:
        return jsonify({'error': 'start_date and completion_date are required (YYYY-MM-DD).'}), 400

    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        completion_date = datetime.strptime(completion_date_str, '%Y-%m-%d').date()
    except ValueError:
        return jsonify({'error': 'Invalid date format. Use YYYY-MM-DD.'}), 400

    if completion_date < start_date:
        return jsonify({'error': 'completion_date cannot be earlier than start_date.'}), 400

    dept_to_use = department if department else (intern.department or 'DEVWORK STUDIO')
    if not dept_to_use or 'full stack' in dept_to_use.lower():
        dept_to_use = 'DEVWORK STUDIO'
    
    # Check if a certificate/letter already exists for this intern
    existing_letter = InternshipLetter.query.filter_by(intern_id=intern.id).first()
    update_existing = str(data.get('update_existing', '')).lower() in ('true', '1', 'yes')

    if existing_letter and not update_existing:
        return jsonify({
            'error': f'A completion certificate has already been issued for {intern.full_name} (Code: {existing_letter.letter_number}). Do you want to update it?',
            'already_exists': True,
            'letter_id': existing_letter.id,
            'letter_number': existing_letter.letter_number,
            'existing_letter': existing_letter.to_dict()
        }), 409

    # Handle optional PDF or Word document file
    doc_filename = None
    doc_path = None
    file = request.files.get('letter_file') or request.files.get('file') or request.files.get('document')
    if file and file.filename:
        if not allowed_letter_doc(file.filename):
            return jsonify({
                'error': 'Unsupported document format. Please upload a PDF or Word document (.pdf, .doc, .docx).'
            }), 400
        
        ext = file.filename.rsplit('.', 1)[1].lower()
        clean_base = secure_filename(file.filename.rsplit('.', 1)[0]) or 'letter'
        ref_code = existing_letter.letter_number if existing_letter else 'new'
        unique_filename = f"letter_{ref_code}_{int(time.time())}_{clean_base}.{ext}"

        upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'letters')
        os.makedirs(upload_folder, exist_ok=True)
        file_dest = os.path.join(upload_folder, unique_filename)
        file.save(file_dest)

        doc_filename = file.filename
        doc_path = f"/static/uploads/letters/{unique_filename}"

    # Dynamic certificate fields
    guardian_name = (data.get('guardian_name') or '').strip() or None
    cnic_no = (data.get('cnic_no') or '').strip() or None
    duration_text = (data.get('duration_text') or '').strip() or 'TWO Months'
    projects_detail = (data.get('projects_detail') or '').strip() or None
    organization_name = (data.get('organization_name') or 'DevWork Studio').strip()
    sub_title = (data.get('sub_title') or 'Software Engineering Skill Development Platform').strip()
    commendation_text = (data.get('commendation_text') or '').strip() or None
    authorized_by = (data.get('authorized_by') or 'DevWork Studio').strip()
    signatory_title = (data.get('signatory_title') or 'Admin Maheen').strip()
    show_stamp = str(data.get('show_stamp', 'true')).lower() in ('true', '1', 'yes')
    custom_logo_url = (data.get('custom_logo_url') or '').strip() or None
    logo_position = (data.get('logo_position') or 'left').strip().lower()
    if logo_position not in ('left', 'center', 'right'):
        logo_position = 'left'
    custom_stamp_url = (data.get('custom_stamp_url') or '').strip() or None

    # Allow editing recipient intern full name dynamically
    intern_name_edit = (data.get('intern_name') or '').strip()
    if intern_name_edit and intern_name_edit != intern.full_name:
        intern.full_name = intern_name_edit
        db.session.add(intern)

    issue_date_to_use = date.today()
    issue_date_str = data.get('issue_date')
    if issue_date_str:
        try:
            issue_date_to_use = datetime.strptime(issue_date_str, '%Y-%m-%d').date()
        except ValueError:
            pass

    # If updating an existing certificate
    if existing_letter and update_existing:
        existing_letter.start_date = start_date
        existing_letter.completion_date = completion_date
        existing_letter.department = dept_to_use
        existing_letter.title = title
        existing_letter.performance_rating = performance_rating
        existing_letter.remarks = remarks if remarks else f'Successfully accomplished the internship program with {performance_rating} dedication and contributions to {dept_to_use}.'
        existing_letter.guardian_name = guardian_name
        existing_letter.cnic_no = cnic_no
        existing_letter.duration_text = duration_text
        existing_letter.projects_detail = projects_detail
        existing_letter.organization_name = organization_name
        existing_letter.sub_title = sub_title
        existing_letter.commendation_text = commendation_text
        existing_letter.authorized_by = authorized_by
        existing_letter.signatory_title = signatory_title
        existing_letter.show_stamp = show_stamp
        if custom_logo_url:
            existing_letter.custom_logo_url = custom_logo_url
        if logo_position:
            existing_letter.logo_position = logo_position
        if custom_stamp_url:
            existing_letter.custom_stamp_url = custom_stamp_url
        existing_letter.issued_by_id = current_user.id
        existing_letter.issue_date = issue_date_to_use
        if doc_filename:
            existing_letter.document_filename = doc_filename
            existing_letter.document_path = doc_path

        if intern.status != 'completed':
            intern.status = 'completed'
            if not intern.end_date:
                intern.end_date = completion_date
            db.session.add(intern)

        db.session.commit()

        return jsonify({
            'message': f'Internship certificate {existing_letter.letter_number} for {intern.full_name} has been updated successfully.',
            'letter': existing_letter.to_dict(),
            'updated': True
        }), 200

    # Otherwise create a new certificate
    letter_number = generate_letter_number()
    letter = InternshipLetter(
        letter_number=letter_number,
        intern_id=intern.id,
        issued_by_id=current_user.id,
        issue_date=issue_date_to_use,
        start_date=start_date,
        completion_date=completion_date,
        title=title,
        department=dept_to_use,
        performance_rating=performance_rating,
        remarks=remarks if remarks else f'Successfully accomplished the internship program with {performance_rating} dedication and contributions to {dept_to_use}.',
        guardian_name=guardian_name,
        cnic_no=cnic_no,
        duration_text=duration_text,
        projects_detail=projects_detail,
        organization_name=organization_name,
        sub_title=sub_title,
        commendation_text=commendation_text,
        authorized_by=authorized_by,
        signatory_title=signatory_title,
        show_stamp=show_stamp,
        custom_logo_url=custom_logo_url,
        logo_position=logo_position,
        custom_stamp_url=custom_stamp_url,
        document_filename=doc_filename,
        document_path=doc_path,
        status='issued'
    )

    # When issuing completion letter, ensure intern is graduated to completed/alumni
    if intern.status != 'completed':
        intern.status = 'completed'
        if not intern.end_date:
            intern.end_date = completion_date
        db.session.add(intern)

    db.session.add(letter)
    db.session.commit()

    return jsonify({
        'message': f'Internship letter {letter_number} issued successfully to {intern.full_name}.',
        'letter': letter.to_dict(),
        'updated': False
    }), 201


@letters_bp.route('', methods=['GET'])
@admin_or_super_admin_required
def get_all_letters(current_user):
    """
    Requirement 6: Admin page where they see all internship letters assigned to interns.
    Rule: Only interns whose internship is completed appear in letters issued.
    """
    intern_id = request.args.get('intern_id')
    query = InternshipLetter.query.join(User, InternshipLetter.intern_id == User.id).filter(User.status == 'completed')

    if intern_id:
        query = query.filter(InternshipLetter.intern_id == intern_id)

    letters = query.order_by(InternshipLetter.issue_date.desc(), InternshipLetter.created_at.desc()).all()

    return jsonify({
        'letters': [l.to_dict() for l in letters],
        'total': len(letters)
    }), 200


@letters_bp.route('/my', methods=['GET'])
@any_authenticated_user
def get_my_letters(current_user):
    """
    Requirement: Only admins can see completion letters, not interns.
    """
    if current_user.role == 'intern':
        return jsonify({'error': 'Permission denied. Completion letters can only be accessed by administrators.'}), 403

    letters = InternshipLetter.query.join(User, InternshipLetter.intern_id == User.id).filter(User.status == 'completed').order_by(InternshipLetter.issue_date.desc()).all()
    return jsonify({
        'letters': [l.to_dict() for l in letters],
        'total': len(letters)
    }), 200


@letters_bp.route('/<int:letter_id>', methods=['GET'])
@admin_or_super_admin_required
def get_letter_by_id(current_user, letter_id):
    """
    Get detailed letter by ID. Strictly restricted to administrators and super admins.
    """
    letter = db.session.get(InternshipLetter, letter_id)
    if not letter:
        return jsonify({'error': 'Internship letter not found.'}), 404

    return jsonify({'letter': letter.to_dict()}), 200


@letters_bp.route('/verify/<string:letter_number>', methods=['GET'])
def verify_letter(letter_number):
    """
    Public verification endpoint to verify authenticity of a letter/certificate.
    """
    letter = InternshipLetter.query.filter_by(letter_number=letter_number).first()
    if not letter:
        return jsonify({'error': 'Letter/Certificate not found or invalid code.', 'valid': False}), 404

    return jsonify({
        'valid': True,
        'letter': letter.to_dict()
    }), 200


@letters_bp.route('/<int:letter_id>/download', methods=['GET'])
@any_authenticated_user
def download_letter_document(current_user, letter_id):
    """
    Download attached PDF or Word document for an issued internship letter.
    Restricted to administrators per access policy.
    """
    if current_user.role == 'intern':
        return jsonify({'error': 'Permission denied. Completion letter documents can only be accessed by administrators.'}), 403

    letter = db.session.get(InternshipLetter, letter_id)
    if not letter:
        return jsonify({'error': 'Internship letter not found.'}), 404

    if not letter.document_path or not letter.document_filename:
        return jsonify({'error': 'No document file attached to this internship letter.'}), 404

    upload_root = os.path.abspath(os.path.join(current_app.root_path, 'static', 'uploads'))
    rel_path = letter.document_path.lstrip('/')
    abs_path = os.path.abspath(os.path.join(current_app.root_path, rel_path))

    # Reject any path traversal attempt
    if not abs_path.startswith(upload_root):
        return jsonify({'error': 'Access denied. Invalid document location.'}), 403

    if not os.path.exists(abs_path):
        return jsonify({'error': 'Document file not found on server.'}), 404

    return send_file(abs_path, as_attachment=True, download_name=letter.document_filename)


@letters_bp.route('/check-intern/<int:intern_id>', methods=['GET'])
@admin_or_super_admin_required
def check_intern_letter(current_user, intern_id):
    """
    Check if a certificate/letter already exists for an intern.
    """
    letter = InternshipLetter.query.filter_by(intern_id=intern_id).first()
    if letter:
        return jsonify({
            'has_letter': True,
            'letter': letter.to_dict()
        }), 200
    return jsonify({
        'has_letter': False,
        'letter': None
    }), 200


@letters_bp.route('/<int:letter_id>', methods=['PUT', 'PATCH'])
@admin_or_super_admin_required
def update_letter(current_user, letter_id):
    """
    Directly update an existing internship letter by ID.
    """
    letter = db.session.get(InternshipLetter, letter_id)
    if not letter:
        return jsonify({'error': 'Internship letter not found.'}), 404

    if request.is_json:
        data = request.get_json() or {}
    else:
        data = request.form.to_dict()

    start_date_str = data.get('start_date')
    completion_date_str = data.get('completion_date')
    department = (data.get('department') or '').strip()
    title = (data.get('title') or '').strip()
    performance_rating = (data.get('performance_rating') or '').strip()
    remarks = (data.get('remarks') or '').strip()

    if start_date_str:
        try:
            letter.start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid start_date format. Use YYYY-MM-DD.'}), 400

    if completion_date_str:
        try:
            letter.completion_date = datetime.strptime(completion_date_str, '%Y-%m-%d').date()
        except ValueError:
            return jsonify({'error': 'Invalid completion_date format. Use YYYY-MM-DD.'}), 400

    if letter.completion_date < letter.start_date:
        return jsonify({'error': 'completion_date cannot be earlier than start_date.'}), 400

    if department:
        if 'full stack' in department.lower():
            department = 'DEVWORK STUDIO'
        letter.department = department
    if title:
        letter.title = title
    if performance_rating:
        letter.performance_rating = performance_rating
    if 'remarks' in data:
        letter.remarks = remarks

    if 'letter_number' in data:
        new_code = (data.get('letter_number') or '').strip().upper()
        if new_code and new_code != letter.letter_number:
            existing_code = InternshipLetter.query.filter(
                InternshipLetter.letter_number == new_code,
                InternshipLetter.id != letter.id
            ).first()
            if existing_code:
                return jsonify({'error': f'Certificate number "{new_code}" is already in use by another credential.'}), 400
            letter.letter_number = new_code

    if 'guardian_name' in data:
        letter.guardian_name = (data.get('guardian_name') or '').strip() or None
    if 'cnic_no' in data:
        letter.cnic_no = (data.get('cnic_no') or '').strip() or None
    if 'duration_text' in data:
        letter.duration_text = (data.get('duration_text') or '').strip() or 'TWO Months'
    if 'projects_detail' in data:
        letter.projects_detail = (data.get('projects_detail') or '').strip() or None
    if 'organization_name' in data:
        letter.organization_name = (data.get('organization_name') or 'DevWork Studio').strip()
    if 'sub_title' in data:
        letter.sub_title = (data.get('sub_title') or 'Software Engineering Skill Development Platform').strip()
    if 'commendation_text' in data:
        letter.commendation_text = (data.get('commendation_text') or '').strip() or None
    if 'authorized_by' in data:
        letter.authorized_by = (data.get('authorized_by') or 'DevWork Studio').strip()
    if 'signatory_title' in data:
        letter.signatory_title = (data.get('signatory_title') or 'Admin Maheen').strip()
    if 'show_stamp' in data:
        letter.show_stamp = str(data.get('show_stamp', 'true')).lower() in ('true', '1', 'yes')
    if 'custom_logo_url' in data:
        letter.custom_logo_url = (data.get('custom_logo_url') or '').strip() or None
    if 'logo_position' in data:
        pos = (data.get('logo_position') or 'left').strip().lower()
        if pos in ('left', 'center', 'right'):
            letter.logo_position = pos
    if 'custom_stamp_url' in data:
        letter.custom_stamp_url = (data.get('custom_stamp_url') or '').strip() or None
    if 'stamp_x' in data:
        if data['stamp_x'] is None:
            letter.stamp_x = None
        else:
            try:
                letter.stamp_x = int(data['stamp_x'])
            except (ValueError, TypeError):
                pass
    if 'stamp_y' in data:
        if data['stamp_y'] is None:
            letter.stamp_y = None
        else:
            try:
                letter.stamp_y = int(data['stamp_y'])
            except (ValueError, TypeError):
                pass

    # Allow updating intern name if provided
    intern_name_edit = (data.get('intern_name') or '').strip()
    if intern_name_edit and letter.intern and intern_name_edit != letter.intern.full_name:
        letter.intern.full_name = intern_name_edit
        db.session.add(letter.intern)

    issue_date_str = data.get('issue_date')
    if issue_date_str:
        try:
            letter.issue_date = datetime.strptime(issue_date_str, '%Y-%m-%d').date()
        except ValueError:
            pass

    # Handle document upload
    file = request.files.get('letter_file') or request.files.get('file') or request.files.get('document')
    if file and file.filename:
        if not allowed_letter_doc(file.filename):
            return jsonify({'error': 'Unsupported document format (.pdf, .doc, .docx).'}), 400
        ext = file.filename.rsplit('.', 1)[1].lower()
        clean_base = secure_filename(file.filename.rsplit('.', 1)[0]) or 'letter'
        unique_filename = f"letter_{letter.letter_number}_{int(time.time())}_{clean_base}.{ext}"
        upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'letters')
        os.makedirs(upload_folder, exist_ok=True)
        file.save(os.path.join(upload_folder, unique_filename))
        letter.document_filename = file.filename
        letter.document_path = f"/static/uploads/letters/{unique_filename}"

    letter.issued_by_id = current_user.id
    db.session.commit()

    return jsonify({
        'message': f'Internship letter {letter.letter_number} updated successfully.',
        'letter': letter.to_dict(),
        'updated': True
    }), 200


@letters_bp.route('/<int:letter_id>', methods=['DELETE'])
@admin_or_super_admin_required
def delete_letter(current_user, letter_id):
    """
    Revoke or delete an issued internship letter.
    """
    letter = db.session.get(InternshipLetter, letter_id)
    if not letter:
        return jsonify({'error': 'Internship letter not found.'}), 404
    db.session.delete(letter)
    db.session.commit()
    return jsonify({'message': f'Letter {letter.letter_number} deleted successfully.'}), 200


@letters_bp.route('/<int:letter_id>/upload-logo', methods=['POST'])
@admin_or_super_admin_required
def upload_letter_logo(current_user, letter_id):
    """
    Upload and set a dynamic company logo for a certificate.
    """
    letter = db.session.get(InternshipLetter, letter_id)
    if not letter:
        return jsonify({'error': 'Internship letter not found.'}), 404

    file = request.files.get('logo') or request.files.get('file') or request.files.get('image')
    if not file or not file.filename:
        return jsonify({'error': 'No image file uploaded.'}), 400

    allowed_exts = {'png', 'jpg', 'jpeg', 'svg', 'webp'}
    if '.' not in file.filename or file.filename.rsplit('.', 1)[1].lower() not in allowed_exts:
        return jsonify({'error': 'Unsupported image format. Allowed: PNG, JPG, JPEG, SVG, WebP.'}), 400

    ext = file.filename.rsplit('.', 1)[1].lower()
    clean_base = secure_filename(file.filename.rsplit('.', 1)[0]) or 'logo'
    unique_filename = f"logo_{letter.letter_number}_{int(time.time())}_{clean_base}.{ext}"

    upload_folder = os.path.join(current_app.root_path, 'static', 'uploads', 'logos')
    os.makedirs(upload_folder, exist_ok=True)
    file_dest = os.path.join(upload_folder, unique_filename)
    file.save(file_dest)

    letter.custom_logo_url = f"/static/uploads/logos/{unique_filename}"
    db.session.commit()

    return jsonify({
        'message': 'Logo uploaded successfully.',
        'logo_url': letter.custom_logo_url,
        'letter': letter.to_dict()
    }), 200


@letters_bp.route('/render-code-assets', methods=['GET'])
def render_code_assets():
    """
    Real-time dynamic QR code and 1D Barcode asset renderer.
    Used for live interactive updates when editing credential ID on certificate.
    """
    code = (request.args.get('code') or '').strip().upper()
    if not code:
        return jsonify({'error': 'Code parameter is required.'}), 400

    host = request.host_url.rstrip('/')
    verify_url = f"{host}/verify/{code}"
    cert_url = f"{host}/certificate/{code}"
    qr_b64 = generate_qr_code_base64(cert_url)
    bc_svg = generate_barcode_svg(cert_url)

    return jsonify({
        'code': code,
        'cert_url': cert_url,
        'verify_url': verify_url,
        'qr_code_b64': qr_b64,
        'barcode_svg': bc_svg
    }), 200



