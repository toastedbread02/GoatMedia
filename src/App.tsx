import { useEffect } from 'react';
import { Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FeedPage } from './pages/FeedPage.tsx';
import { VideoPage } from './pages/VideoPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { UploadPage } from './pages/UploadPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { ContactPage } from './pages/ContactPage.tsx';
import { AboutPage, GuidelinesPage, PrivacyPage, TermsPage } from './pages/DocsPages.tsx';
import { ForgotPasswordPage, LoginPage, NotFoundPage, ResetPasswordPage, SignupPage } from './pages/AuthPages.tsx';
import { recordVisit } from './lib/api.ts';

function AppFrame() {
  const location = useLocation();
  const navigate = useNavigate();

  // Counted once per load, not per route: that keeps the traffic chart about
  // arrivals instead of about how much someone scrolled.
  useEffect(() => {
    recordVisit(location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Links shared before a custom domain carry the old /GoatMedia prefix. When
  // the site moves to the root that prefix is not a route any more, so strip it
  // rather than answering an old link with Not found.
  useEffect(() => {
    const stripped = location.pathname.replace(/^\/GoatMedia(?=\/|$)/i, '');
    if (stripped === location.pathname) return;
    navigate(`${stripped || '/'}${location.search}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    const main = document.getElementById('main');
    if (main) main.scrollTop = 0;
  }, [location.pathname]);

  return (
    <AppShell>
      <ErrorBoundary key={location.pathname}>
        <Outlet />
      </ErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/guidelines" element={<GuidelinesPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/about" element={<AboutPage />} />

      <Route element={<AppFrame />}>
        <Route path="/" element={<FeedPage key="foryou" tab="foryou" />} />
        <Route path="/trending" element={<FeedPage key="trending" tab="trending" />} />
        <Route path="/following" element={<FeedPage key="following" tab="following" />} />
        <Route path="/v/:id" element={<VideoPage />} />
        <Route path="/u/:username" element={<ProfilePage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
