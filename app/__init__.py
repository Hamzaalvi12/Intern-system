import os
from flask import Flask, jsonify, request
from flask_migrate import Migrate
from flask_jwt_extended import JWTManager
from config import Config
from app.models import db, User

migrate = Migrate()
jwt = JWTManager()

def create_app(config_class=Config):
    app = Flask(__name__, template_folder='templates', static_folder='static')
    app.config.from_object(config_class)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)

    # JWT Error Handlers
    @jwt.unauthorized_loader
    def custom_unauthorized_response(callback):
        return jsonify({
            'error': 'Missing Authorization Header with Bearer token.',
            'status': 'unauthorized'
        }), 401

    @jwt.invalid_token_loader
    def custom_invalid_token_response(callback):
        return jsonify({
            'error': 'The provided token is invalid or malformed.',
            'status': 'invalid_token'
        }), 401

    @jwt.expired_token_loader
    def custom_expired_token_response(jwt_header, jwt_payload):
        return jsonify({
            'error': 'Your session token has expired. Please log in again.',
            'status': 'token_expired'
        }), 401

    # Generic Error Handlers for API routes
    @app.errorhandler(404)
    def not_found_error(error):
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Resource not found', 'status': 404}), 404
        return "Page Not Found", 404

    @app.errorhandler(413)
    def request_entity_too_large(error):
        if request.path.startswith('/api/'):
            return jsonify({'error': 'Uploaded file exceeds the maximum permitted size of 16MB.', 'status': 413}), 413
        return "File too large (Max 16MB)", 413

    # Enterprise HTTP Security Headers (Defense-in-Depth)
    @app.after_request
    def set_security_headers(response):
        # Prevent clickjacking by disallowing framing
        response.headers['X-Frame-Options'] = 'DENY'
        # Prevent MIME-sniffing
        response.headers['X-Content-Type-Options'] = 'nosniff'
        # Legacy XSS protection
        response.headers['X-XSS-Protection'] = '1; mode=block'
        # Control referrer information leakages
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        # Restrict browser feature permissions
        response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=(), payment=()'
        # Content Security Policy (Strict with Google Fonts support)
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data: https: blob:; "
            "connect-src 'self'; "
            "object-src 'none'; "
            "frame-ancestors 'none'; "
            "base-uri 'self';"
        )
        # Prevent caching of sensitive API responses
        if request.path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
            response.headers['Pragma'] = 'no-cache'
        return response

    # Register blueprints
    from app.routes.web import web_bp
    from app.routes.auth import auth_bp
    from app.routes.interns import interns_bp
    from app.routes.tasks import tasks_bp
    from app.routes.attendance import attendance_bp
    from app.routes.letters import letters_bp
    from app.routes.messages import messages_bp

    app.register_blueprint(web_bp)
    app.register_blueprint(auth_bp, url_prefix='/api/auth')
    app.register_blueprint(interns_bp, url_prefix='/api/interns')
    app.register_blueprint(tasks_bp, url_prefix='/api/tasks')
    app.register_blueprint(attendance_bp, url_prefix='/api/attendance')
    app.register_blueprint(letters_bp, url_prefix='/api/letters')
    app.register_blueprint(messages_bp, url_prefix='/api/messages')

    # Schema integrity check and automatic credential ID backfill
    with app.app_context():
        try:
            with db.engine.connect() as conn:
                conn.execute(db.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS credential_id VARCHAR(50);"))
                conn.execute(db.text("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_credential_id ON users(credential_id);"))
                conn.commit()

            # Auto-migrate any remaining old DWS or FSZ style credential IDs or None
            old_or_missing = User.query.filter(
                (User.credential_id.is_(None)) | 
                (User.credential_id.like('FSZ-%')) | 
                (User.credential_id.like('DWS-%'))
            ).order_by(User.id.asc()).all()
            if old_or_missing:
                from app.utils import generate_intern_credential_id
                for u in old_or_missing:
                    u.credential_id = generate_intern_credential_id(u.role)
                db.session.commit()

            # Auto-migrate legacy 'full stack' departments to 'DEVWORK STUDIO'
            full_stack_users = User.query.filter(User.department.ilike('%full stack%')).all()
            for u in full_stack_users:
                u.department = 'DEVWORK STUDIO'
            full_stack_letters = InternshipLetter.query.filter(InternshipLetter.department.ilike('%full stack%')).all()
            for l in full_stack_letters:
                l.department = 'DEVWORK STUDIO'
            if full_stack_users or full_stack_letters:
                db.session.commit()
        except Exception:
            pass

    # Seed command
    @app.cli.command("seed")
    def seed_database():
        """Seed initial super admin and sample records."""
        with app.app_context():
            db.create_all()
            from seed import run_seed
            run_seed()

    return app
