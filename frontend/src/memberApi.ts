import axios from 'axios';

// See api.ts for why this is relative in production (same-origin, merged single
// container) and absolute in local dev (frontend :5173, backend :8000).
const memberApi = axios.create({
  baseURL: import.meta.env.DEV ? 'http://localhost:8000' : '',
});

// Member Auth
export const loginMember = async (formData: FormData) => {
  const response = await memberApi.post('/members/login', formData);
  return response.data;
};

export const registerMember = async (memberData: any) => {
  const response = await memberApi.post('/members/register', memberData);
  return response.data;
};

export const getMemberProfile = async () => {
  const response = await memberApi.get('/members/me');
  return response.data;
};

export const updateMemberProfile = async (data: any) => {
  const response = await memberApi.patch('/members/me', data);
  return response.data;
};

export const getMemberOrders = async () => {
  const response = await memberApi.get('/members/me/orders');
  return response.data;
};

export const getMemberAddresses = async () => {
  const response = await memberApi.get('/members/me/addresses');
  return response.data;
};

export const addMemberAddress = async (address: any) => {
  const response = await memberApi.post('/members/me/addresses', address);
  return response.data;
};

export const getMemberDMs = async () => {
  const response = await memberApi.get('/dms/me');
  return response.data;
};

export const getMemberDMFavorites = async () => {
  const response = await memberApi.get('/dms/me/favorites');
  return response.data;
};

export const toggleDMFavorite = async (dmId: number) => {
  const response = await memberApi.post(`/dms/me/${dmId}/favorite`);
  return response.data;
};

export const trackDMView = async (dmId: number) => {
  await memberApi.post(`/dms/me/${dmId}/view`);
};

export const trackDMClick = async (dmId: number) => {
  await memberApi.post(`/dms/me/${dmId}/click`);
};

export const getMailSymbols = async (memberId: number, params?: any) => {
  const response = await memberApi.get(`/api/v1/members/${memberId}/mail-symbols`, { params });
  return response.data;
};

export const markMailSymbolRead = async (mailSymbolId: string) => {
  const response = await memberApi.patch(`/api/v1/mail-symbols/${mailSymbolId}/read`);
  return response.data;
};

export const getPointsEvents = async () => {
  const response = await memberApi.get('/api/v1/points/events');
  return response.data;
};

export const exchangePoints = async (eventId: number) => {
  const response = await memberApi.post(`/api/v1/points/exchange/${eventId}`);
  return response.data;
};

export const getPointsHistory = async () => {
  const response = await memberApi.get('/api/v1/points/history');
  return response.data;
};

// Interceptor for Member Token
memberApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('member_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor
memberApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('member_token');
      localStorage.removeItem('member');
      if (!window.location.pathname.startsWith('/member/login') && !window.location.pathname.startsWith('/member/register')) {
        window.location.href = '/member/login';
      }
    }
    return Promise.reject(error);
  }
);

export default memberApi;
