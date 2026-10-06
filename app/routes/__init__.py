from app.routes.auth import auth_bp
from app.routes.interns import interns_bp
from app.routes.tasks import tasks_bp
from app.routes.attendance import attendance_bp
from app.routes.letters import letters_bp
from app.routes.messages import messages_bp
from app.routes.web import web_bp

__all__ = [
    'auth_bp',
    'interns_bp',
    'tasks_bp',
    'attendance_bp',
    'letters_bp',
    'messages_bp',
    'web_bp'
]
