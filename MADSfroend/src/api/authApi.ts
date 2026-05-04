import request from "../utils/request";
import type { AuthResponse, LoginCredential, UserInfo } from "../types/auth";

export const authApi = {
  login(credential: LoginCredential) {
    if (credential.grantType === "password") {
      return request.post<AuthResponse>("/auth/login", {
        grantType: "password",
        username: credential.username,
        password: credential.password,
      });
    }
    if (credential.grantType === "phone_otp") {
      return request.post<AuthResponse>("/auth/login", {
        grantType: "phone_otp",
        phone: credential.phone,
        otp: credential.otp,
      });
    }
    return request.post<AuthResponse>("/auth/login", {
      grantType: "email_otp",
      email: credential.email,
      otp: credential.otp,
    });
  },
  register(payload: {
    username: string;
    password: string;
    phone: string;
    phoneOtp: string;
    captchaId: string;
    captchaAnswer: string;
  }) {
    return request.post<AuthResponse>("/auth/register", payload, { timeout: 30000 });
  },
  me() {
    return request.get<UserInfo>("/auth/me");
  },
  setPassword(body: { newPassword: string; currentPassword?: string }) {
    return request.post<UserInfo>("/auth/set-password", body, { timeout: 15000 });
  },  sendPhoneOtp(target: string) {
    return request.post<{ message: string; devCode: string }>("/auth/otp/phone", { target });
  },
  sendEmailOtp(target: string) {
    return request.post<{ message: string; devCode: string }>("/auth/otp/email", { target });
  },
  getCaptcha() {
    return request.post<{ sessionId: string; question: string }>("/auth/captcha");
  },
};
