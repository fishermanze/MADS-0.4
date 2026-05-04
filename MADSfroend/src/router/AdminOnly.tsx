import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

interface Props {
  children: React.ReactNode;
}

export default function AdminOnly({ children }: Props) {
  const { user } = useAuth();
  if (user?.role !== "ADMIN") {
    return <Navigate to="/MADS" replace />;
  }
  return <>{children}</>;
}
