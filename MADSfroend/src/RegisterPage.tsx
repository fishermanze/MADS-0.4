import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authApi } from "./api/authApi";
import { AuthShellAside, IconLock, IconUser } from "./components/AuthShellVisuals";
import { useAuth } from "./context/AuthContext";
import "./auth-shell.css";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/MADS", { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    if (username.trim().length < 3) {
      setErr("用户名至少 3 位。");
      return;
    }
    if (password.length < 8) {
      setErr("密码至少 8 位。");
      return;
    }
    setBusy(true);
    try {
      const res = await authApi.register({ username: username.trim(), password });
      localStorage.setItem("token", res.accessToken);
      setUser(res.user);
      navigate("/MADS", { replace: true });
    } catch {
      setErr("注册失败，用户名可能已被占用。");
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
            加入我们，体验多智能体对话与干预实验。
          </p>

          <form onSubmit={(e) => void onSubmit(e)} noValidate>
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
