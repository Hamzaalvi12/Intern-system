import os
import hashlib
import subprocess
import tempfile
from flask import Blueprint, render_template, abort, jsonify, send_from_directory, send_file, current_app, request, redirect
from app.models import InternshipLetter, User
from app.utils import generate_qr_code_base64, generate_barcode_svg

web_bp = Blueprint('web', __name__)

@web_bp.route('/favicon.ico')
def favicon():
    return send_from_directory(
        os.path.join(current_app.root_path, 'static', 'img'),
        'favicon.ico',
        mimetype='image/vnd.microsoft.icon'
    )

@web_bp.route('/')
def index():
    return render_template('index.html')

@web_bp.route('/admin/letters')
def admin_letters():
    """
    Dedicated page for Admins and Super Admins to view the full registry
    of all issued internship certificate letters, detailing whom each letter was issued to.
    """
    letters = InternshipLetter.query.order_by(InternshipLetter.issue_date.desc(), InternshipLetter.created_at.desc()).all()
    total_letters = len(letters)
    approved_interns = User.query.filter_by(role='intern', status='approved').order_by(User.full_name.asc()).all()
    return render_template('admin_letters.html', letters=letters, total_letters=total_letters, approved_interns=approved_interns)

@web_bp.route('/certificate/<string:letter_number>')
def print_certificate(letter_number):
    letter = InternshipLetter.query.filter_by(letter_number=letter_number).first()
    if not letter:
        abort(404, description="Internship Letter not found.")
    
    # Generate authentic scannable QR code encoding direct certificate URL
    cert_url = request.host_url.rstrip('/') + f"/certificate/{letter.letter_number}"
    verify_url = request.host_url.rstrip('/') + f"/verify/{letter.letter_number}"
    qr_code_b64 = generate_qr_code_base64(cert_url)
    barcode_svg = generate_barcode_svg(cert_url)
    
    return render_template('letter_print.html', 
                           letter=letter, 
                           cert_url=cert_url,
                           verify_url=verify_url,
                           qr_code_b64=qr_code_b64, 
                           barcode_svg=barcode_svg)

@web_bp.route('/verify/<string:letter_number>')
def public_verify_credential(letter_number):
    """
    Public Credential Verification Portal.
    When scanned by smartphone camera or barcode scanner, opens the verified intern record.
    """
    letter = InternshipLetter.query.filter_by(letter_number=letter_number).first()
    if not letter:
        return render_template('letter_verify.html', letter=None, query_code=letter_number, valid=False), 404
    
    cert_url = request.host_url.rstrip('/') + f"/certificate/{letter.letter_number}"
    verify_url = request.host_url.rstrip('/') + f"/verify/{letter.letter_number}"
    qr_code_b64 = generate_qr_code_base64(verify_url)
    barcode_svg = generate_barcode_svg(cert_url)
    
    fingerprint_raw = f"{letter.letter_number}:{letter.intern_id}:{letter.issue_date}:{letter.department}"
    verification_hash = hashlib.sha256(fingerprint_raw.encode('utf-8')).hexdigest()[:20].upper()
    
    return render_template('letter_verify.html',
                           letter=letter,
                           valid=True,
                           cert_url=cert_url,
                           verify_url=verify_url,
                           qr_code_b64=qr_code_b64,
                           barcode_svg=barcode_svg,
                           verification_hash=verification_hash)

@web_bp.route('/verify', methods=['GET'])
def public_verify_search():
    raw_code = (request.args.get('code') or '').strip()
    if raw_code:
        if '/certificate/' in raw_code:
            code = raw_code.split('/certificate/')[-1].strip('/')
        elif '/verify/' in raw_code:
            code = raw_code.split('/verify/')[-1].strip('/')
        else:
            code = raw_code.upper()
        return redirect(f"/verify/{code}")
    return render_template('letter_verify.html', letter=None, valid=None)

@web_bp.route('/certificate/<string:letter_number>/pdf')
def export_certificate_pdf(letter_number):
    """
    Direct server-side high-fidelity PDF export using Chrome headless print-to-pdf.
    Guarantees crisp vector graphics, correct A4 portrait, background graphics, and ZERO white/blank page.
    """
    letter = InternshipLetter.query.filter_by(letter_number=letter_number).first()
    if not letter:
        abort(404, description="Internship Letter not found.")

    clean_name = "".join(c for c in (letter.intern.full_name if letter.intern else "Intern") if c.isalnum() or c in (' ', '_', '-')).strip().replace(' ', '_')
    pdf_filename = f"Certificate_{letter.letter_number}_{clean_name}.pdf"
    
    temp_dir = tempfile.gettempdir()
    out_pdf_path = os.path.join(temp_dir, f"cert_{letter.letter_number}.pdf")
    
    port = int(os.environ.get('PORT', 5000))
    cert_url = f"http://127.0.0.1:{port}/certificate/{letter.letter_number}?pdfmode=1"
    
    cmd = [
        '/usr/bin/google-chrome',
        '--headless',
        '--disable-gpu',
        '--no-pdf-header-footer',
        '--window-size=1200,1600',
        '--run-all-compositor-stages-before-draw',
        f'--print-to-pdf={out_pdf_path}',
        cert_url
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, timeout=15)
        if res.returncode == 0 and os.path.exists(out_pdf_path) and os.path.getsize(out_pdf_path) > 1000:
            return send_file(out_pdf_path, as_attachment=True, download_name=pdf_filename, mimetype='application/pdf')
    except Exception as e:
        current_app.logger.error(f"Chrome PDF generation error: {e}")
    
    abort(500, description="Could not generate PDF.")

@web_bp.route('/api/health')
def health():
    return jsonify({'status': 'healthy', 'system': 'Intern Management System v1.0.0'}), 200
