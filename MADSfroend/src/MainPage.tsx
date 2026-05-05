import { NavLink, Outlet, useNavigate } from "react-router-dom";
import "./main-layout.css";
import { useAuth } from "./context/AuthContext";
import { useTheme } from "./context/ThemeContext";

function MainPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const isAdmin = user?.role === "ADMIN";

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
            <button className="theme-toggle" onClick={toggleTheme} title="切换深色/浅色主题">
              {theme === "light" ? "🌙" : "☀️"}
            </button>
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

      <main className="main-layout-content">
        <Outlet />
      </main>
    </>
  );
}

export default MainPage;
