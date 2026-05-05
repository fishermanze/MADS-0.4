import request from "../utils/request";
import type { AuthResponse, LoginCredential, UserInfo } from "../types/auth";

export const authApi = {
  login(credential: LoginCredential) {
    return request.post<AuthResponse>("/auth/login", {
      username: credential.username,
      password: credential.password,
    });
  },
  register(payload: { username: string; password: string }) {
    return request.post<AuthResponse>("/auth/register", payload, { timeout: 30000 });
  },
  me() {
    return request.get<UserInfo>("/auth/me");
  },
  setPassword(body: { newPassword: string; currentPassword?: string }) {
    return request.post<UserInfo>("/auth/set-password", body, { timeout: 15000 });
  },
};
