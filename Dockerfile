# Multi-stage build: frontend (React/Vite) build output gets baked into the
# backend (FastAPI) image, so the whole system runs as a single container that
# serves both the web pages and the API on one port. See docs/deployment-plan.md.

FROM node:20-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ .
# VITE_LIFF_ID must be baked in at build time (Vite inlines import.meta.env.VITE_*
# at compile time, unlike a normal runtime env var) — see docker-compose.yml's
# build.args for where this comes from.
ARG VITE_LIFF_ID=""
ENV VITE_LIFF_ID=$VITE_LIFF_ID
RUN npm run build

FROM python:3.13-slim AS runtime
# Without this, plain print() calls (e.g. the one-time admin bootstrap password,
# or error logging in members.py/marketing scheduler) sit in Python's stdout
# buffer instead of reaching `docker logs` promptly — since stdout isn't a TTY
# inside a container, Python full-buffers it by default instead of line-buffering.
ENV PYTHONUNBUFFERED=1
# LINE 圖文選單的圖由後端即時畫（backend/line_menu_render.py），需要繁中字型
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv

WORKDIR /app

# Install dependencies first so this layer is cached across code-only changes.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev

COPY backend/ ./backend/
COPY --from=frontend-builder /frontend/dist ./frontend_dist

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
