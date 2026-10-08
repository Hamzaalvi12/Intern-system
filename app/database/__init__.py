"""
Database initialization and connection management module.
Provides singleton db instance and migration helpers.
"""
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

# Expose models for convenient database operations (e.g. from app.database import db, User, Task)
def get_models():
    from app.models import User, Task, TaskProgressUpdate, Attendance, InternshipLetter, Message
    return {
        'User': User,
        'Task': Task,
        'TaskProgressUpdate': TaskProgressUpdate,
        'Attendance': Attendance,
        'InternshipLetter': InternshipLetter,
        'Message': Message
    }
