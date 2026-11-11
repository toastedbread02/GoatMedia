import { useEffect } from 'react';
import { Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from './components/AppShell.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FeedPage } from './pages/FeedPage.tsx';
import { UploadPage } from './pages/UploadPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { TagPage } from './pages/TagPage.tsx';
import { SoundPage } from './pages/SoundPage.tsx';
import { HistoryPage } from './pages/HistoryPage.tsx';
import { MessagesPage } from './pages/MessagesPage.tsx';
import { AdminPage } from './pages/AdminPage.tsx';
import { ContactPage } from './pages/ContactPage.tsx';
import { AppealPage } from './pages/AppealPage.tsx';
import { DailyPage } from './pages/DailyPage.tsx';
import {
  AboutPage,
  CookiesPage,
  CopyrightPage,
  GuidelinesPage,
  PrivacyPage,
  TermsPage,
} from './pages/DocsPages.tsx';
import { ForgotPasswordPage, LoginPage, NotFoundPage, ResetPasswordPage, SignupPage } from './pages/AuthPages.tsx';
import { recordVisit } from './lib/api.ts';
import { recordTrail } from './lib/argTrail.ts';
import { ProfileRoute, VideoRoute } from './pages/ArgRoutes.tsx';
import { ArgDatabasePage } from './pages/ArgDatabasePage.tsx';
import { ArgDatabaseRowPage } from './pages/ArgDatabaseRowPage.tsx';
import { ArgSysLoginPage } from './pages/ArgSysLoginPage.tsx';
import { ArgBlankPage } from './pages/ArgBlankPage.tsx';

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

  // The browser keeps its own copy of where it has been, which is what the
  // dump reads back. Nothing here is sent anywhere.
  useEffect(() => {
    recordTrail(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

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
      <Route path="/cookies" element={<CookiesPage />} />
      <Route path="/copyright" element={<CopyrightPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/appeal/:token" element={<AppealPage />} />
      <Route path="/sys/login" element={<ArgSysLoginPage />} />
      <Route path="/sys/blank" element={<ArgBlankPage />} />

      <Route element={<AppFrame />}>
        <Route path="/" element={<FeedPage key="foryou" tab="foryou" />} />
        <Route path="/trending" element={<FeedPage key="trending" tab="trending" />} />
        <Route path="/following" element={<FeedPage key="following" tab="following" />} />
        <Route path="/v/:id" element={<VideoRoute />} />
        <Route path="/daily" element={<DailyPage />} />
        <Route path="/u/:username" element={<ProfileRoute />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/tag/:tag" element={<TagPage />} />
        <Route path="/sound/:id" element={<SoundPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/admin/d1" element={<ArgDatabasePage />} />
        <Route path="/admin/d1/:id" element={<ArgDatabaseRowPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
