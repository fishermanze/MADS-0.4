import { type FormEvent, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import "./main-layout.css";
import { authApi } from "./api/authApi";
import { useAuth } from "./context/AuthContext";

function MainPage() {
  const navigate = useNavigate();
  const { user, logout, setUser } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const needPassword = !!(user?.mustSetPassword === true);

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwBusy, setPwBusy] = useState(false);

  const onSubmitPassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwErr("");
    if (pw1.length < 8) {
      setPwErr("密码至少 8 位。");
      return;
    }
    if (pw1 !== pw2) {
      setPwErr("两次输入的密码不一致。");
      return;
    }
    setPwBusy(true);
    try {
      const next = await authApi.setPassword({ newPassword: pw1 });
      setUser(next);
      setPw1("");
      setPw2("");
    } catch {
      setPwErr("设置失败，请稍后重试。");
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <>
      <div className="main-layout">
        <header className="main-layout-header">
          <button className="main-layout-brand" onClick={() => navigate("/")}>
            <span className="main-layout-brand-glyph">⌬</span>
            MADS 多智能体对话系统
          </button>
          <nav className="main-layout-nav">
            <NavLink
              className={({ isActive }) =>
                isActive ? "main-layout-link active" : "main-layout-link"
              }
              to="/MADS"
            >
              对话系统
            </NavLink>
            <NavLink
              className={({ isActive }) =>
                isActive ? "main-layout-link active" : "main-layout-link"
              }
              to="/INTERVENTION"
            >
              干预实验
            </NavLink>
            {isAdmin && (
              <NavLink
                className={({ isActive }) =>
                  isActive ? "main-layout-link active" : "main-layout-link"
                }
                to="/STAT"
              >
                统计页面
              </NavLink>
            )}
            <NavLink
              className={({ isActive }) =>
                isActive ? "main-layout-link active" : "main-layout-link"
              }
              to="/SETTINGS"
            >
              设置
            </NavLink>
          </nav>
          <div className="main-layout-user">
            <span className="main-layout-username" title={user?.email ?? undefined}>
              {user?.username}
              <span className="main-layout-role">{isAdmin ? "管理员" : "用户"}</span>
            </span>
            <button
              type="button"
              className="main-layout-logout"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
            >
              退出
            </button>
          </div>
        </header>
        <main className="main-layout-content">
          <Outlet />
        </main>
      </div>

      {needPassword && (
        <div className="main-layout-password-backdrop">
          <div className="main-layout-password-modal" role="dialog" aria-modal="true">
            <h2 className="main-layout-password-title">请设置登录密码</h2>
            <p className="main-layout-password-desc">
              您通过邮箱验证码首次登录，系统已使用该邮箱为您创建账号。请设置<strong>用户名密码登录</strong>使用的密码（至少 8
              位）。
            </p>
            <form onSubmit={(e) => void onSubmitPassword(e)} className="main-layout-password-form">
              <label className="main-layout-password-label">
                新密码
                <input
                  type="password"
                  className="main-layout-password-input"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <label className="main-layout-password-label">
                确认密码
                <input
                  type="password"
                  className="main-layout-password-input"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              {pwErr && <div className="main-layout-password-error">{pwErr}</div>}
              <button type="submit" className="main-layout-password-submit" disabled={pwBusy}>
                {pwBusy ? "保存中…" : "保存密码"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default MainPage;
