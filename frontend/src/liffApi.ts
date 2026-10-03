import axios from 'axios';

// Production build is served by the same FastAPI container as the API (see api.ts),
// so a relative baseURL resolves correctly even though this page opens inside the
// LINE app on the user's phone rather than a desktop browser — it's still the same
// origin as the backend. Local dev runs the frontend separately from the backend, so
// VITE_API_BASE_URL (falling back to localhost:8000) is needed there instead.
// 2026-10-03：這行曾被舊版蓋回寫死 localhost，正式環境 LINE 內的頁面全部打不到後端。
const BASE_URL = import.meta.env.DEV ? (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000') : '';

const liffApi = axios.create({ baseURL: BASE_URL });

// The LIFF ID token is short-lived and managed by the LIFF SDK itself (liff.getIDToken()),
// so rather than caching a copy here, LiffContext registers a getter once liff.init()
// resolves and every request pulls a fresh token through it.
let idTokenGetter: (() => string | null | undefined) | null = null;

export const registerLiffIdTokenGetter = (getter: (() => string | null | undefined) | null) => {
  idTokenGetter = getter;
};

liffApi.interceptors.request.use((config) => {
  const token = idTokenGetter ? idTokenGetter() : null;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// LIFF-authenticated endpoints (see backend/liff_router.py) — these require the
// Authorization: Bearer <line_id_token> header attached by the interceptor above.
export const getLiffMe = async () => (await liffApi.get('/liff/me')).data;
export const getLiffActions = async () => (await liffApi.get('/liff/actions')).data;
export const createLiffSession = async () => (await liffApi.post('/liff/session')).data;

export default liffApi;
