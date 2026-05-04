export interface UserInfo {
  id: string;
  username: string;
  phone?: string | null;
  email?: string | null;
  role: string;
  /** 邮箱验证码首次登录自动开户后为 true，需在主界面设置正式密码 */
  mustSetPassword?: boolean;
}
export interface AuthResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: UserInfo;
}

export type LoginCredential =
  | { grantType: "password"; username: string; password: string }
  | { grantType: "phone_otp"; phone: string; otp: string }
  | { grantType: "email_otp"; email: string; otp: string };
