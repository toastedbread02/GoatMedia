import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AdminPage } from './pages/AdminPage';
import { ForgotPage, RegisterPage, ResetPage, SignInPage } from './pages/AuthPages';
import { CategoryPage } from './pages/CategoryPage';
import { GuidelinesPage, PrivacyPage, TermsPage } from './pages/DocsPages';
import { FeedPage } from './pages/FeedPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { PostPage } from './pages/PostPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReportPage } from './pages/ReportPage';
import { SearchPage } from './pages/SearchPage';
import { SettingsPage } from './pages/SettingsPage';
import { UploadPage } from './pages/UploadPage';
import { AuthProvider } from './lib/auth';
import { ConfigProvider } from './lib/config';
import { SoundProvider } from './lib/sound';
import { ToastProvider } from './lib/toast';

function NotFound() {
  return (
    <div className="column column--reading">
      <div className="empty">
        <p className="empty__title">This page went wandering</p>
        <p>No goats at this address. The feed is still where you left it.</p>
        <a className="button" href="#/">
          Back to For You
        </a>
      </div>
    </div>
  );
}

export function App() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <AuthProvider>
          <SoundProvider>
            <HashRouter>
              <Routes>
                <Route element={<AppShell />}>
                  <Route path="/" element={<FeedPage tab="foryou" />} />
                  <Route path="/trending" element={<FeedPage tab="trending" />} />
                  <Route path="/following" element={<FeedPage tab="following" />} />
                  <Route path="/upload" element={<UploadPage />} />
                  <Route path="/u/:username" element={<ProfilePage />} />
                  <Route path="/p/:id" element={<PostPage />} />
                  <Route path="/c/:id" element={<CategoryPage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/notifications" element={<NotificationsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="/report/:type/:id" element={<ReportPage />} />
                  <Route path="/guidelines" element={<GuidelinesPage />} />
                  <Route path="/privacy" element={<PrivacyPage />} />
                  <Route path="/terms" element={<TermsPage />} />
                  <Route path="/signin" element={<SignInPage />} />
                  <Route path="/register" element={<RegisterPage />} />
                  <Route path="/forgot" element={<ForgotPage />} />
                  <Route path="/reset" element={<ResetPage />} />
                  <Route path="/me" element={<Navigate to="/settings" replace />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </HashRouter>
          </SoundProvider>
        </AuthProvider>
      </ToastProvider>
    </ConfigProvider>
  );
}
