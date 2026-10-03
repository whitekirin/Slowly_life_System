from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    LINE_CHANNEL_ID: str = ""
    LINE_CHANNEL_SECRET: str = ""
    LINE_LOGIN_CALLBACK_URL: str = "http://localhost:8000/line/callback"
    LINE_MESSAGING_ACCESS_TOKEN: str = ""
    # Messaging API channel 的 secret，webhook 驗簽用。Login 和 Messaging 是不同 channel 時兩個 secret 不同；
    # 沒設定就沿用 LINE_CHANNEL_SECRET（兩者共用同一組時）。
    LINE_MESSAGING_CHANNEL_SECRET: str = ""
    LINE_SUPPRESS_SEND: bool = True
    FRONTEND_BASE_URL: str = "http://localhost:5173"

    # LIFF (LINE Front-end Framework) app used for in-chat operations (e.g. filling
    # out a purchase order). LIFF_CHANNEL_ID defaults to LINE_CHANNEL_ID when unset,
    # since most setups register the LIFF app under the same LINE Login channel.
    LIFF_ID: str = ""
    LIFF_CHANNEL_ID: str = ""

    # Empty string = database.py falls back to its local SQLite file (dev default).
    # Set to a SQLAlchemy URL (e.g. postgresql+psycopg://user:pass@host:5432/db) in production.
    DATABASE_URL: str = ""

    # JWT signing secret shared by auth.py/members.py's token checks.
    # The placeholder default is fine for local dev; production MUST override this via .env.
    SECRET_KEY: str = "your-secret-key-keep-it-secret-change-me-in-production"

    # This backend's own publicly reachable base URL (used to build links/URLs embedded
    # in responses or outgoing emails, e.g. uploaded file URLs, marketing tracking pixels).
    # Distinct from FRONTEND_BASE_URL because in local dev the frontend (5173) and backend
    # (8000) are different origins; in the merged Docker deployment they're the same domain.
    PUBLIC_BASE_URL: str = "http://localhost:8000"

    # Comma-separated list of allowed CORS origins.
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:8000"


settings = Settings()
