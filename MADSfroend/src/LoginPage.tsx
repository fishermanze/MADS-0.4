import { useEffect, useState } from "react";
import type React from "react";
import { Link, useNavigate } from "react-router-dom";
import { AuthShellAside, IconLock, IconUser } from "./components/AuthShellVisuals";
import { useAuth } from "./context/AuthContext";
import "./auth-shell.css";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      navigate("/MADS", { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr("");
    if (!username.trim() || !password) {
      setErr("请输入用户名和密码。");
      return;
    }
    setBusy(true);
    try {
      await login({ username: username.trim(), password });
      navigate("/MADS", { replace: true });
    } catch {
      setErr("登录失败，请检查用户名和密码。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell-root">
      <div className="auth-split-card">
        <AuthShellAside />

        <div className="auth-panel">
          <Link className="auth-home-link" to="/">
            返回首页
          </Link>

          <h1 className="auth-title">欢迎回来 :)</h1>
          <p className="auth-lead">
            使用个人账号信息登录，即可继续使用多智能体对话、干预实验与数据统计（按角色可见）。
          </p>

          <form onSubmit={(e) => void onSubmit(e)} noValidate>
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

            {err && <div className="auth-error">{err}</div>}

            <div className="auth-actions">
              <button type="submit" className="auth-btn-primary" disabled={busy}>
                {busy ? "请稍候…" : "立即登录"}
              </button>
              <Link className="auth-btn-outline" to="/register">
                注册账号
              </Link>
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
