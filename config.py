import os
from datetime import timedelta
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv('DATABASE_URL', 'postgresql://postgres:alvi420@localhost:5432/intern-flask')
if db_url and db_url.startswith('postgresql://'):
    db_url = db_url.replace('postgresql://', 'postgresql+psycopg2://', 1)

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'super-secret-jwt-key-2026-intern-management-system-production-secret')
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'jwt-token-secret-key-flask-internship-management-system-secure-32bytes-min')
    SQLALCHEMY_DATABASE_URI = db_url
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(days=7)
    JWT_TOKEN_LOCATION = ['headers']
    JWT_HEADER_NAME = 'Authorization'
    JWT_HEADER_TYPE = 'Bearer'
    # Security: Limit maximum upload size to 16MB to prevent Denial of Service (DoS)
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024
    # Security: Cookie protections
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'