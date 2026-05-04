import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "./api/authApi";
import {
  AuthShellAside,
  IconLock,
  IconPhone,
  IconSum,
  IconUser,
} from "./components/AuthShellVisuals";
import { useAuth } from "./context/AuthContext";
import "./auth-shell.css";

const CN_PHONE_RE = /^1[3-9]\d{9}$/;

export default function RegisterPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneOtp, setPhoneOtp] = useState("");
  const [captchaId, setCaptchaId] = useState("");
  const [captchaQuestion, setCaptchaQuestion] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/MADS", { replace: true });
    }
  }, [user, navigate]);

  const refreshCaptcha = async () => {
    const c = await authApi.getCaptcha();
    setCaptchaId(c.sessionId);
    setCaptchaQuestion(c.question);
  };

  useEffect(() => {
    void refreshCaptcha().catch(() => undefined);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    const phoneT = phone.trim();
    if (!CN_PHONE_RE.test(phoneT)) {
      setErr("请填写中国大陆 11 位手机号。");
      return;
    }
    if (!phoneOtp.trim()) {
      setErr("请填写手机验证码。");
      return;
    }

    setBusy(true);
    try {
      const res = await authApi.register({
        username,
        password,
        phone: phoneT,
        phoneOtp: phoneOtp.trim(),
        captchaId,
        captchaAnswer,
      });
      localStorage.setItem("token", res.accessToken);
      setUser(res.user);
      navigate("/MADS", { replace: true });
    } catch {
      setErr("注册失败，请检查用户名、密码、算术验证码与手机验证码。");
      void refreshCaptcha();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell-root auth-shell-root--register-layout">
      <div className="auth-split-card auth-split-card--register">
        <AuthShellAside />

        <div className="auth-panel auth-panel--register">
          <Link className="auth-home-link" to="/">
            返回首页
          </Link>

          <h1 className="auth-title">创建账号 ✨</h1>
          <p className="auth-lead">
            加入我们，体验多智能体对话与干预实验。请使用<strong>手机号 + 手机短信验证码</strong>完成绑定；算术验证码必填（本地模拟短信
            devCode）。
          </p>

          <form onSubmit={(e) => void onSubmit(e)} noValidate>
            <p className="auth-section-label">账号信息</p>
            <div className="auth-form-grid">
              <div className="auth-field">
                <IconUser />
                <input
                  placeholder="用户名（≥3 位）"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                  minLength={3}
                />
              </div>
              <div className="auth-field">
                <IconLock />
                <input
                  type="password"
                  placeholder="密码（≥8 位）"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                />
              </div>
              <div className="auth-field" style={{ gridColumn: "1 / -1" }}>
                <span className="auth-field-icon">
                  <IconPhone />
                </span>
                <input
                  placeholder="手机号（必填）"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="numeric"
                  autoComplete="tel"
                />
              </div>
            </div>

            <p className="auth-section-label">手机短信验证</p>
            <div className="auth-otp-inline">
              <div className="auth-field">
                <IconLock />
                <input
                  placeholder="手机验证码"
                  value={phoneOtp}
                  onChange={(e) => setPhoneOtp(e.target.value)}
                  inputMode="numeric"
                />
              </div>
              <button
                type="button"
                className="auth-send-code"
                onClick={() => {
                  const p = phone.trim();
                  if (!CN_PHONE_RE.test(p)) {
                    setErr("请先填写有效手机号。");
                    return;
                  }
                  setErr("");
                  void authApi.sendPhoneOtp(p).then((r) => {
                    alert(`模拟短信验证码：${r.devCode}`);
                  });
                }}
              >
                获取
              </button>
            </div>

            <p className="auth-section-label">人机验证</p>
            <p style={{ margin: "0 0 8px", fontSize: "13px", color: "#475569" }}>
              请计算：<strong>{captchaQuestion || "…"}</strong>
            </p>
            <div className="auth-otp-inline" style={{ marginBottom: 14 }}>
              <div className="auth-field">
                <IconSum />
                <input
                  placeholder="填写答案"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  required
                />
              </div>
              <button type="button" className="auth-send-code" onClick={() => void refreshCaptcha()}>
                换一题
              </button>
            </div>

            {err && <div className="auth-error">{err}</div>}

            <div className="auth-actions">
              <button type="submit" className="auth-btn-primary" disabled={busy}>
                {busy ? "提交中…" : "完成注册"}
              </button>
              <Link className="auth-btn-outline" to="/login">
                已有账号，去登录
              </Link>
            </div>

            <p className="auth-footer-links">
              注册即表示您了解本平台为研究与演示环境 · <Link to="/">了解更多</Link>
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
