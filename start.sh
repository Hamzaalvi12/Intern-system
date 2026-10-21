#!/bin/bash
exec >> /home/intern_management/internship-flask/flask.log 2>&1
echo "[$(date)] Starting Flask..."
cd /home/intern_management/internship-flask || exit 1
exec /home/intern_management/venv/bin/python3 run.py
