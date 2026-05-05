import { useAuth } from "./context/AuthContext";
import "./auth-pages.css";

export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <div className="settings-page">
      <h2>个人设置</h2>
      <p className="settings-tip">Phase 2：展示当前账号信息；后续可在此接入头像上传、模型用量统计与文档中心。</p>
      <dl className="settings-dl">
        <dt>用户名</dt>
        <dd>{user?.username}</dd>
        <dt>角色</dt>
        <dd>{user?.role === "ADMIN" ? "管理员" : "普通用户"}</dd>
      </dl>
    </div>
  );
}
