from fastapi_mail import ConnectionConfig, FastMail, MessageSchema, MessageType
from pydantic import EmailStr, BaseModel
from typing import List
import os
import logging
import uuid
from datetime import datetime
from backend.config import settings

# --- Logging Setup ---
email_logger = logging.getLogger("email_delivery")
email_logger.setLevel(logging.INFO)
file_handler = logging.FileHandler("email_delivery.log")
file_handler.setFormatter(logging.Formatter('[%(asctime)s] %(message)s', datefmt='%Y-%m-%dT%H:%M:%S%z'))
email_logger.addHandler(file_handler)

# --- Prometheus Metrics ---
try:
    from prometheus_client import Counter
    EMAIL_SENT_TOTAL = Counter("email_sent_total", "Total emails sent successfully", ["type"])
    EMAIL_FAILED_TOTAL = Counter("email_failed_total", "Total emails failed to send", ["type", "reason"])
    EMAIL_BOUNCED_TOTAL = Counter("email_bounced_total", "Total emails bounced")
except ImportError:
    class DummyCounter:
        def __init__(self, *args, **kwargs): pass
        def labels(self, *args, **kwargs): return self
        def inc(self, *args, **kwargs): pass
    EMAIL_SENT_TOTAL = DummyCounter()
    EMAIL_FAILED_TOTAL = DummyCounter()
    EMAIL_BOUNCED_TOTAL = DummyCounter()

class EmailSchema(BaseModel):
    email: List[EmailStr]

# Placeholder configuration - User should update this in production
conf = ConnectionConfig(
    MAIL_USERNAME = os.getenv("MAIL_USERNAME", "user@example.com"),
    MAIL_PASSWORD = os.getenv("MAIL_PASSWORD", "password"),
    MAIL_FROM = os.getenv("MAIL_FROM", "admin@example.com"),
    MAIL_PORT = int(os.getenv("MAIL_PORT", 587)),
    MAIL_SERVER = os.getenv("MAIL_SERVER", "smtp.gmail.com"),
    MAIL_FROM_NAME=os.getenv("MAIL_FROM_NAME", "Smart Inventory System"),
    MAIL_STARTTLS = True,
    MAIL_SSL_TLS = False,
    USE_CREDENTIALS = True,
    VALIDATE_CERTS = True,
    SUPPRESS_SEND = 1 # Set to 0 to actually send emails
)

async def send_reset_password_email(email: EmailStr, token: str, base_url: str = settings.FRONTEND_BASE_URL):
    reset_link = f"{base_url}/reset-password?token={token}"
    print(f"DEBUG: Password Reset Link: {reset_link}")
    
    html = f"""
    <html>
        <body>
            <div style="font-family: Arial, sans-serif; padding: 20px;">
                <h2>重設密碼請求 (Password Reset Request)</h2>
                <p>您好 (Hello),</p>
                <p>我們收到了您的密碼重設請求。請點擊下方連結以重設您的密碼：</p>
                <br>
                <a href="{reset_link}" style="background-color: #1890ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 4px;">重設密碼 (Reset Password)</a>
                <br><br>
                <p>此連結將在 30 分鐘後失效。如果您沒有請求重設密碼，請忽略此郵件。</p>
            </div>
        </body>
    </html>
    """

    message = MessageSchema(
        subject="[Smart Inventory] 重設密碼 Password Reset",
        recipients=[email],
        body=html,
        subtype=MessageType.html
    )

    fm = FastMail(conf)
    await fm.send_message(message)

async def send_discount_email(email: str, code: str, title: str, valid_until: datetime, description: str):
    message_id = str(uuid.uuid4())
    
    # Check required environment variables
    # If SUPPRESS_SEND is 1, it's considered a mock/test send but we still log it.
    is_suppressed = os.getenv("SUPPRESS_SEND", "1") == "1"
    
    # HTML content for discount code
    html = f"""
    <html>
        <body>
            <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; background-color: #f9f0ff; border-radius: 12px;">
                <h2 style="color: #531dab; text-align: center;">專屬折扣碼通知 (Your Exclusive Discount Code)</h2>
                <p>您好 (Hello),</p>
                <p>恭喜您成功兌換 <strong>{title}</strong>！</p>
                <p>{description}</p>
                
                <div style="background-color: #fff; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
                    <p style="margin: 0; color: #8c8c8c; font-size: 14px;">您的折扣碼為 (Your Code):</p>
                    <h1 style="color: #531dab; letter-spacing: 2px; margin: 10px 0;">{code}</h1>
                    <p style="margin: 0; color: #fa8c16; font-size: 12px;">有效期限 (Valid Until): {valid_until.strftime('%Y-%m-%d %H:%M')}</p>
                </div>
                
                <p style="font-size: 12px; color: #8c8c8c;">
                    * 提醒您：若您收不到後續信件，請確保將 admin@example.com 加入白名單。<br/>
                    * 網域管理員須知：為確保信件不被歸類為垃圾郵件，請至 DNS 設定正確的 SPF, DKIM, DMARC 紀錄。
                </p>
            </div>
        </body>
    </html>
    """

    message = MessageSchema(
        subject=f"[VIP 專屬] 您的 {title} 兌換碼已發放",
        recipients=[email],
        body=html,
        subtype=MessageType.html,
        headers={"Message-ID": f"<{message_id}@example.com>"}
    )

    fm = FastMail(conf)
    
    try:
        if is_suppressed:
            email_logger.info(f"EMAIL_MOCK message-id={message_id} recipient={email} type=discount response=suppressed_by_config")
            EMAIL_SENT_TOTAL.labels(type="discount").inc()
            return True
            
        await fm.send_message(message)
        email_logger.info(f"EMAIL_DELIVERED message-id={message_id} recipient={email} type=discount response=250_OK")
        EMAIL_SENT_TOTAL.labels(type="discount").inc()
        return True
    except Exception as e:
        error_msg = str(e).replace('\n', ' ')
        email_logger.error(f"EMAIL_FAILED message-id={message_id} recipient={email} type=discount response=error reason='{error_msg}'")
        EMAIL_FAILED_TOTAL.labels(type="discount", reason="smtp_error").inc()
        return False