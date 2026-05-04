import axios from "axios";
import type { AxiosRequestConfig } from "axios";

/** 本地开发：`vite` 只对 `/api` 做反向代理（见 vite.config）；未设置 env 时必须走 `/api`，否则会打到 5173 根路径拿到 index.html，被当成登录态。 */
const configured = import.meta.env.VITE_API_BASE_URL?.trim();
const baseURL = configured && configured.length > 0 ? configured : "/api";

const instance = axios.create({
  baseURL,
  timeout: 5000,
  headers: { "Content-Type": "application/json" },
});

instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

instance.interceptors.response.use(
  (response) => {
    const ct = String(response.headers["content-type"] ?? "");
    if (ct.includes("text/html")) {
      console.error("[api] Unexpected HTML response (check VITE_API_BASE_URL / proxy):", response.config.url);
      return Promise.reject(new Error("API returned HTML instead of JSON"));
    }
    return response;
  },
  (error) => {
    console.error("请求出错", error);
    return Promise.reject(error);
  },
);

const request = {
  get<T>(url: string, config?: AxiosRequestConfig) {
    return instance.get<T>(url, config).then((response) => response.data);
  },
  post<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return instance.post<T>(url, data, config).then((response) => response.data);
  },
  patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return instance.patch<T>(url, data, config).then((response) => response.data);
  },
  delete<T>(url: string, config?: AxiosRequestConfig) {
    return instance.delete<T>(url, config).then((response) => response.data);
  },
};

export default request;