import { Navigate } from "react-router-dom";
import MainPage from "../MainPage";
import { useAuth } from "../context/AuthContext";

export default function RequireAuthLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        加载中…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <MainPage />;
}
