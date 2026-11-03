import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import type { Role } from "../types";
import { Spinner } from "./ui";

export function ProtectedRoute({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-brand-600">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Access restricted</h1>
          <p className="mt-2 text-sm text-slate-500">This area is reserved for authorised laboratory staff.</p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
