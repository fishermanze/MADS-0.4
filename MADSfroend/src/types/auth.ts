export interface UserInfo {
  id: string;
  username: string;
  role: string;
}

export interface AuthResponse {
  accessToken: string;
  expiresInSeconds: number;
  user: UserInfo;
}

export interface LoginCredential {
  username: string;
  password: string;
}
