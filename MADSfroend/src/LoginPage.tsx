import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "./api/authApi";
import { AuthShellAside, IconMail, IconPhone, IconLock, IconUser } from "./components/AuthShellVisuals";
import { useAuth } from "./context/AuthContext";
import type { LoginCredential } from "./types/auth";
import "./auth-shell.css";

type LoginMode = LoginCredential["grantType"];

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [mode, setMode] = useState<LoginMode>("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/MADS", { replace: true });
    }
  }, [user, navigate]);

  useEffect(() => {
    setErr("");
    setOtp("");
  }, [mode]);

  const credentialFromForm = (): LoginCredential | null => {
    setErr("");
    if (mode === "password") {
      if (!username.trim() || !password) {
        setErr("请输入用户名和密码。");
        return null;
      }
      return { grantType: "password", username: username.trim(), password };
    }
    if (mode === "phone_otp") {
      const p = phone.trim();
      if (!/^1[3-9]\d{9}$/.test(p)) {
        setErr("请输入有效中国大陆手机号。");
        return null;
      }
      if (!otp.trim()) {
        setErr("请输入短信验证码。");
        return null;
      }
      return { grantType: "phone_otp", phone: p, otp: otp.trim() };
    }
    const em = email.trim().toLowerCase();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr("请输入有效邮箱。");
      return null;
    }
    if (!otp.trim()) {
      setErr("请输入邮箱验证码。");
      return null;
    }
    return { grantType: "email_otp", email: em, otp: otp.trim() };
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const credential = credentialFromForm();
    if (!credential) return;
    setBusy(true);
    try {
      await login(credential);
      navigate("/MADS", { replace: true });
    } catch {
      setErr(
        mode === "password"
          ? "登录失败，请检查用户名和密码。"
          : "验证码错误或已过期；若该手机号/邮箱尚未注册，请先注册。",
      );
    } finally {
      setBusy(false);
    }
  };

  const sendPhoneCode = () => {
    const p = phone.trim();
    if (!/^1[3-9]\d{9}$/.test(p)) {
      setErr("请先填写有效手机号。");
      return;
    }
    setErr("");
    void authApi.sendPhoneOtp(p).then((r) => {
      alert(`模拟短信验证码：${r.devCode}`);
    });
  };

  const sendEmailCode = () => {
    const em = email.trim().toLowerCase();
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr("请先填写有效邮箱。");
      return;
    }
    setErr("");
    void authApi.sendEmailOtp(em).then((r) => {
      alert(`模拟邮箱验证码：${r.devCode}`);
    });
  };

  const lead =
    mode === "password"
      ? "使用个人账号信息登录，即可继续使用多智能体对话、干预实验与数据统计（按角色可见）。"
      : mode === "phone_otp"
        ? "已向本机模拟环境发送短信验证码（devCode），完成验证即可登录绑定该手机号的账号。"
        : "已向本机模拟环境发送邮件验证码（devCode），完成验证即可登录绑定该邮箱的账号。";

  return (
    <div className="auth-shell-root">
      <div className="auth-split-card">
        <AuthShellAside />

        <div className="auth-panel">
          <Link className="auth-home-link" to="/">
            返回首页
          </Link>

          {mode !== "password" && (
            <button type="button" className="auth-back" onClick={() => setMode("password")}>
              ← 使用密码登录
            </button>
          )}

          <h1 className="auth-title">欢迎回来 :)</h1>
          <p className="auth-lead">{lead}</p>

          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            {mode === "password" && (
              <>
                <div className="auth-field">
                  <IconUser />
                  <input
                    name="username"
                    autoComplete="username"
                    placeholder="用户名"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="auth-field">
                  <IconLock />
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    placeholder="密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="auth-row-between">
                  <label className="auth-remember">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    记住我
                  </label>
                  <a
                    className="auth-forgot"
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      alert("请联系管理员重置密码，或前往注册页创建新账号。");
                    }}
                  >
                    忘记密码？
                  </a>
                </div>
              </>
            )}

            {mode === "phone_otp" && (
              <>
                <div className="auth-field">
                  <span className="auth-field-icon">
                    <IconPhone />
                  </span>
                  <input
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="手机号"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div className="auth-otp-inline" style={{ marginBottom: 14 }}>
                  <div className="auth-field" style={{ marginBottom: 0 }}>
                    <IconLock />
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6 位验证码"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                    />
                  </div>
                  <button type="button" className="auth-send-code" onClick={sendPhoneCode}>
                    获取验证码
                  </button>
                </div>
              </>
            )}

            {mode === "email_otp" && (
              <>
                <div className="auth-field">
                  <span className="auth-field-icon">
                    <IconMail />
                  </span>
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="邮箱地址"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="auth-otp-inline" style={{ marginBottom: 14 }}>
                  <div className="auth-field" style={{ marginBottom: 0 }}>
                    <IconLock />
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6 位验证码"
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                    />
                  </div>
                  <button type="button" className="auth-send-code" onClick={sendEmailCode}>
                    获取验证码
                  </button>
                </div>
              </>
            )}

            {err && <div className="auth-error">{err}</div>}

            <div className="auth-actions">
              <button type="submit" className="auth-btn-primary" disabled={busy}>
                {busy ? "请稍候…" : mode === "password" ? "立即登录" : "验证并登录"}
              </button>
              <Link className="auth-btn-outline" to="/register">
                注册账号
              </Link>
            </div>

            <p className="auth-divider">或使用以下方式登录</p>
            <div className="auth-alt-row">
              <button
                type="button"
                className={`auth-alt-btn auth-alt-btn--phone ${mode === "phone_otp" ? "auth-alt-btn--active" : ""}`}
                aria-label="手机号验证码登录"
                aria-pressed={mode === "phone_otp"}
                onClick={() => setMode("phone_otp")}
              >
                <IconPhone />
              </button>
              <button
                type="button"
                className={`auth-alt-btn auth-alt-btn--email ${mode === "email_otp" ? "auth-alt-btn--active" : ""}`}
                aria-label="邮箱验证码登录"
                aria-pressed={mode === "email_otp"}
                onClick={() => setMode("email_otp")}
              >
                <IconMail />
              </button>
            </div>
          </form>

          <p className="auth-footer-links">
            需要帮助？请联系管理员 · <Link to="/">了解 MADS</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
