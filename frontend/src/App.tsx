import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Layout from './components/layout/Layout';
import HomePage from './pages/HomePage';
import ModelCenterPage from './pages/ModelCenterPage';
import KnowledgeBasePage from './pages/KnowledgeBasePage';
import KnowledgeDocDetailPage from './pages/KnowledgeDocDetailPage';
import ChatPage from './pages/ChatPage';
import DocPreviewPage from './pages/DocPreviewPage';
import ArchivePage from './pages/ArchivePage';
import ArchiveDetailPage from './pages/ArchiveDetailPage';
import ScalePage from './pages/ScalePage';
import ScaleAnswerPage from './pages/ScaleAnswerPage';
import ScaleResultPage from './pages/ScaleResultPage';
import RiskPage from './pages/RiskPage';
import MapPage from './pages/MapPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfilePage from './pages/ProfilePage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import { useAuthStore } from './store/authStore';
import { ReactNode } from 'react';

/** 路由守卫：未登录用户重定向到登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/** 路由守卫：已登录用户重定向到首页（防止重复登录） */
function GuestGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) {
    return <Navigate to="/home" replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#2F6BFF',
          colorInfo: '#2F6BFF',
          colorSuccess: '#1F9D72',
          colorWarning: '#F59E0B',
          colorError: '#DC2626',
          borderRadius: 14,
          colorBgLayout: '#F6F8FB',
          colorBgContainer: '#FFFFFF',
          colorBorder: '#E2E8F0',
          colorText: '#162033',
          colorTextSecondary: '#66758F',
          boxShadowSecondary: '0 18px 40px rgba(15, 23, 42, 0.08)',
        },
      }}
    >
      <BrowserRouter>
        <Routes>
          {/* ========== 公开路由（无需登录） ========== */}
          <Route
            path="/login"
            element={
              <GuestGuard>
                <LoginPage />
              </GuestGuard>
            }
          />
          <Route
            path="/register"
            element={
              <GuestGuard>
                <RegisterPage />
              </GuestGuard>
            }
          />

          {/* ========== 受保护路由（需要登录） ========== */}
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="home" element={<HomePage />} />
            <Route path="model" element={<ModelCenterPage />} />
            <Route path="model/template" element={<ModelCenterPage />} />
            <Route path="model-center" element={<Navigate to="/model" replace />} />
            <Route path="model-center/template" element={<Navigate to="/model/template" replace />} />
            <Route path="knowledge" element={<KnowledgeBasePage />} />
            <Route path="knowledge/detail" element={<KnowledgeDocDetailPage />} />
            <Route path="chat" element={<ChatPage />} />
            <Route path="doc-preview" element={<DocPreviewPage />} />
            <Route path="archive" element={<ArchivePage />} />
            <Route path="archive/detail/:archiveId" element={<ArchiveDetailPage />} />
            <Route path="scale" element={<ScalePage />} />
            <Route path="scale/answer/:taskId" element={<ScaleAnswerPage />} />
            <Route path="scale/result/:taskId" element={<ScaleResultPage />} />
            <Route path="risk" element={<RiskPage />} />
            <Route path="map" element={<MapPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="change-password" element={<ChangePasswordPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
