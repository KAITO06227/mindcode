import axios from 'axios';

// API Base URL を環境に応じて設定
const getApiBaseUrl = () => {
  // 本番環境（minecode.si.aoyama.ac.jp）では相対パス
  if (window.location.hostname === 'minecode.si.aoyama.ac.jp') {
    return '';
  }
  // 開発環境では localhost
  return 'http://localhost:3001';
};

// Axios インスタンスを作成
const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
});

// 認証トークンをリクエストヘッダーに追加
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
export const API_BASE_URL = getApiBaseUrl();
