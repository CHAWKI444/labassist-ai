import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Spinner } from "./components/ui";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { DashboardPage } from "./pages/admin/DashboardPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { ChatPage } from "./pages/ChatPage";
import { HistoryPage } from "./pages/HistoryPage";
import { InvitationsPage } from "./pages/InvitationsPage";
import { LoginPage } from "./pages/LoginPage";
import { MemoryPage } from "./pages/MemoryPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DocumentsPage } from "./pages/staff/DocumentsPage";
import { KnowledgePage } from "./pages/staff/KnowledgePage";
import { LabVisionLayout } from "./components/labvision/LabVisionLayout";
import { LabVisionAnomaliesPage } from "./pages/labvision/AnomaliesPage";
import { LabVisionHistoryPage } from "./pages/labvision/HistoryPage";
import { LabVisionImportPage } from "./pages/labvision/ImportPage";
import { LabVisionOverviewPage } from "./pages/labvision/OverviewPage";
import { LabVisionQualityPage } from "./pages/labvision/QualityPage";
import { LabVisionReportsPage } from "./pages/labvision/ReportsPage";
import { LabVisionTrendsPage } from "./pages/labvision/TrendsPage";

// Recharts is only downloaded when the dashboard is opened.
const AnalyticsDashboardPage = lazy(() =>
  import("./pages/AnalyticsDashboardPage").then((m) => ({ default: m.AnalyticsDashboardPage })),
);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/invite" element={<AcceptInvitePage />} />
      <Route
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route path="/chat" element={<ChatPage />} />
        <Route
          path="/dashboard"
          element={
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-primary">
                  <Spinner className="h-6 w-6" />
                </div>
              }
            >
              <AnalyticsDashboardPage />
            </Suspense>
          }
        />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="/staff/documents"
          element={
            <ProtectedRoute roles={["staff", "admin"]}>
              <DocumentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/knowledge"
          element={
            <ProtectedRoute roles={["staff", "admin"]}>
              <KnowledgePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/labvision"
          element={
            <ProtectedRoute roles={["staff", "admin"]}>
              <LabVisionLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<LabVisionOverviewPage />} />
          <Route path="import" element={<LabVisionImportPage />} />
          <Route path="quality" element={<LabVisionQualityPage />} />
          <Route path="anomalies" element={<LabVisionAnomaliesPage />} />
          <Route path="trends" element={<LabVisionTrendsPage />} />
          <Route path="reports" element={<LabVisionReportsPage />} />
          <Route path="history" element={<LabVisionHistoryPage />} />
        </Route>
        <Route
          path="/invitations"
          element={
            <ProtectedRoute roles={["staff", "admin"]}>
              <InvitationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={["admin"]}>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={["admin"]}>
              <UsersPage />
            </ProtectedRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
