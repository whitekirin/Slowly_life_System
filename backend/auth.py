import calendar
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi.security import OAuth2PasswordBearer
from fastapi import Depends, HTTPException, status
from sqlmodel import Session, select
from backend.database import get_session
from backend.models import User
from backend.user_permissions import LEGACY_EXPANSION
from backend.config import settings

# Secret key for JWT encoding/decoding, read from the SECRET_KEY env var/.env via config.py.
# The default in config.py is a placeholder for local dev; production must override
# SECRET_KEY in .env with a random value (e.g. `openssl rand -hex 32`).
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def create_password_reset_token(email: str):
    expire = datetime.utcnow() + timedelta(minutes=30)
    to_encode = {"sub": email, "scope": "reset_password", "exp": expire, "iat": datetime.utcnow()}
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def _token_predates_password_change(payload: dict, changed_at: Optional[datetime]) -> bool:
    """True if this token was issued before the account's last password change
    (or has no iat at all, e.g. an older token from before this check existed),
    meaning it must be rejected even though it hasn't expired yet. Also makes a
    password-reset token single-use: using it bumps changed_at to "now", which
    is after the reset token's own iat, so a replay of the same token fails.

    Both sides are compared as whole-second epoch integers: JWT "iat" is
    second-precision by spec (RFC 7519 NumericDate), while changed_at keeps
    microseconds, so comparing a naive datetime built from iat against the
    full-precision changed_at would spuriously flag same-second logins (e.g.
    right after account creation) as predating the password. calendar.timegm
    (not .timestamp()) is used because changed_at is a naive datetime that
    already represents UTC (from datetime.utcnow()) — .timestamp() would
    wrongly interpret it as local time."""
    if changed_at is None:
        return False
    iat = payload.get("iat")
    if iat is None:
        return True
    issued_at_ts = int(iat) if isinstance(iat, (int, float)) else calendar.timegm(iat.utctimetuple())
    changed_at_ts = calendar.timegm(changed_at.utctimetuple())
    return issued_at_ts < changed_at_ts

def verify_reset_token(token: str, session: Session):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        scope = payload.get("scope")
        email = payload.get("sub")
        if scope != "reset_password" or email is None:
            return None
    except JWTError:
        return None

    user = session.exec(select(User).where(User.email == email)).first()
    if user is None:
        return None
    if _token_predates_password_change(payload, user.password_changed_at):
        return None
    return email

async def get_current_user(token: str = Depends(oauth2_scheme), session: Session = Depends(get_session)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = session.exec(select(User).where(User.username == username)).first()
    if user is None:
        raise credentials_exception
    if _token_predates_password_change(payload, user.password_changed_at):
        raise credentials_exception
    return user

async def get_current_active_user(current_user: User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

def has_any_permission(user: User, required_permissions: list[str]) -> bool:
    """Shared permission check, usable outside of FastAPI Depends() contexts
    (e.g. the LINE webhook and LIFF routers, which authenticate via a bound
    LINE account rather than a system JWT)."""
    if user.is_superuser:
        return True
    user_perms = user.permissions or []
    if "all" in user_perms:
        return True
    return any(_grants(user_perms, perm) for perm in required_permissions)


# 同一功能的權限：查看 view_X；新增 create_X、修改／刪除 edit_X 各自涵蓋查看；核准 approve_X 涵蓋修改／刪除。
# 舊版的編輯 manage_X（新增＋修改＋刪除）仍視為同時有 create_X 與 edit_X（manage_system 本身就是系統設定的權限）。
# 前端 frontend/src/permissions.ts 的 grantsPermission 是同一條規則。
IMPLIED_BY = {
    "view_": ("create_", "edit_", "approve_", "manage_"),
    "create_": ("manage_",),
    "edit_": ("approve_", "manage_"),
}


def _grants(user_perms: list[str], perm: str) -> bool:
    # 還沒遷移的舊 manage_X 展開成它涵蓋的新權限（含拆出去的子功能），見 user_permissions.LEGACY_EXPANSION
    user_perms = [*user_perms, *(q for p in user_perms for q in LEGACY_EXPANSION.get(p, ()))]
    if perm in user_perms:
        return True
    for prefix, higher in IMPLIED_BY.items():
        if perm.startswith(prefix):
            module = perm[len(prefix):]
            return any(f"{h}{module}" in user_perms for h in higher)
    return False


def require_permissions(required_permissions: list[str]):
    async def permission_checker(current_user: User = Depends(get_current_active_user)):
        if not has_any_permission(current_user, required_permissions):
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return current_user
    return permission_checker
