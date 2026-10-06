from datetime import datetime, timezone
from flask import Blueprint, request, jsonify
from app.models import db, User, Message
from app.utils import (
    any_authenticated_user,
    intern_required,
    admin_or_super_admin_required
)

messages_bp = Blueprint('messages', __name__)

@messages_bp.route('', methods=['POST'])
@any_authenticated_user
def send_message(current_user):
    """
    Requirement 8: Intern can send message to admins (or admin can message intern).
    """
    data = request.get_json() or {}

    subject = (data.get('subject') or '').strip()
    body = (data.get('body') or '').strip()
    priority = (data.get('priority') or 'normal').strip().lower()
    recipient_id = data.get('recipient_id')

    if not subject:
        return jsonify({'error': 'Subject is required.'}), 400
    if not body:
        return jsonify({'error': 'Message content (body) is required.'}), 400

    if priority not in ['low', 'normal', 'urgent']:
        priority = 'normal'

    target_recipient = None
    if recipient_id:
        target_recipient = db.session.get(User, recipient_id)
        if not target_recipient:
            return jsonify({'error': f'Recipient user with ID {recipient_id} not found.'}), 404

    # If intern is sending, and no recipient specified, it automatically routes to Admin Inbox (recipient_id=None)
    message = Message(
        sender_id=current_user.id,
        recipient_id=target_recipient.id if target_recipient else None,
        subject=subject,
        body=body,
        priority=priority,
        is_read=False
    )

    db.session.add(message)
    db.session.commit()

    return jsonify({
        'message': 'Message sent successfully to administration.',
        'data': message.to_dict()
    }), 201


@messages_bp.route('', methods=['GET'])
@any_authenticated_user
def get_messages(current_user):
    """
    Retrieve messages:
    - If admin: can view all intern inquiries/messages sent to admins or themselves.
    - If intern: views messages they sent or received.
    """
    if current_user.role in ['admin', 'super_admin']:
        # Admin views top-level messages sent to admin pool or to this specific admin
        messages = Message.query.filter(
            Message.reply_to_id.is_(None),
            (Message.recipient_id.is_(None)) | 
            (Message.recipient_id == current_user.id) | 
            (Message.sender_id == current_user.id)
        ).order_by(Message.created_at.desc()).all()
    else:
        # Intern views messages they sent or received
        messages = Message.query.filter(
            Message.reply_to_id.is_(None),
            (Message.sender_id == current_user.id) | (Message.recipient_id == current_user.id)
        ).order_by(Message.created_at.desc()).all()

    return jsonify({
        'messages': [m.to_dict(include_replies=True) for m in messages],
        'total': len(messages)
    }), 200


@messages_bp.route('/<int:message_id>/reply', methods=['POST'])
@any_authenticated_user
def reply_message(current_user, message_id):
    """
    Reply to a message thread.
    """
    parent = db.session.get(Message, message_id)
    if not parent:
        return jsonify({'error': 'Parent message not found.'}), 404

    # Authorization check
    if current_user.role == 'intern':
        if parent.sender_id != current_user.id and parent.recipient_id != current_user.id:
            return jsonify({'error': 'Permission denied. You cannot reply to this thread.'}), 403

    data = request.get_json() or {}
    body = (data.get('body') or '').strip()
    if not body:
        return jsonify({'error': 'Reply body is required.'}), 400

    # Determine recipient of the reply
    if current_user.id == parent.sender_id:
        recipient_id = parent.recipient_id
    else:
        recipient_id = parent.sender_id

    reply = Message(
        sender_id=current_user.id,
        recipient_id=recipient_id,
        subject=f"Re: {parent.subject}",
        body=body,
        reply_to_id=parent.id,
        is_read=False
    )

    # Mark parent as read if admin is replying or reading
    parent.is_read = True

    db.session.add(reply)
    db.session.commit()

    return jsonify({
        'message': 'Reply sent successfully.',
        'reply': reply.to_dict(include_replies=False)
    }), 201


@messages_bp.route('/<int:message_id>/read', methods=['PATCH'])
@any_authenticated_user
def mark_as_read(current_user, message_id):
    """
    Mark message as read.
    """
    msg = db.session.get(Message, message_id)
    if not msg:
        return jsonify({'error': 'Message not found.'}), 404

    msg.is_read = True
    db.session.commit()

    return jsonify({'message': 'Marked as read.'}), 200
