import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { Layout } from './components/Layout.jsx';
import { RequireRole } from './components/RequireRole.jsx';
import { Loading } from './components/ui/Loading.jsx';

import LoginPage from './pages/LoginPage.jsx';

import AdminDashboard from './pages/admin/AdminDashboard.jsx';
import OwnersPage from './pages/admin/OwnersPage.jsx';
import SetupOwnerPage from './pages/admin/SetupOwnerPage.jsx';
import OwnerDetailPage from './pages/admin/OwnerDetailPage.jsx';
import JobsPage from './pages/admin/JobsPage.jsx';
import JobDetailPage from './pages/admin/JobDetailPage.jsx';
import CostsPage from './pages/admin/CostsPage.jsx';
import CommissionsPage from './pages/admin/CommissionsPage.jsx';
import PaychecksPage from './pages/admin/PaychecksPage.jsx';
import SettingsPage from './pages/admin/SettingsPage.jsx';
import AuditLogPage from './pages/admin/AuditLogPage.jsx';

import OwnerDashboard from './pages/owner/OwnerDashboard.jsx';
import OwnerJobsPage from './pages/owner/OwnerJobsPage.jsx';
import OwnerJobDetailPage from './pages/owner/OwnerJobDetailPage.jsx';
import OwnerCommissionsPage from './pages/owner/OwnerCommissionsPage.jsx';
import OwnerPaychecksPage from './pages/owner/OwnerPaychecksPage.jsx';

// `primary` items become the phone bottom-bar tabs; the rest live under "More".
const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', shortLabel: 'Home', icon: '▚', end: true, primary: true },
  { to: '/admin/owners', label: 'Owners', icon: '👥', primary: true },
  { to: '/admin/jobs', label: 'Jobs', icon: '💼', primary: true },
  { to: '/admin/costs', label: 'Costs', icon: '🧾' },
  { to: '/admin/commissions', label: 'Commissions', icon: '🤝' },
  { to: '/admin/paychecks', label: 'Paychecks', shortLabel: 'Pay', icon: '📆', primary: true },
  { to: '/admin/settings', label: 'Settings', icon: '⚙' },
  { to: '/admin/audit', label: 'Audit Log', icon: '📝' },
];

const OWNER_NAV = [
  { to: '/owner', label: 'Home', shortLabel: 'Home', icon: '▚', end: true, primary: true },
  { to: '/owner/jobs', label: 'My Jobs', shortLabel: 'Jobs', icon: '💼', primary: true },
  { to: '/owner/paychecks', label: 'Paychecks', shortLabel: 'Pay', icon: '📆', primary: true },
  { to: '/owner/commissions', label: 'Referrals', shortLabel: 'Referrals', icon: '🤝' },
];

function HomeRedirect() {
  const { loading, isAuthenticated, role } = useAuth();
  if (loading) return <Loading full />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={role === 'admin' ? '/admin' : '/owner'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireRole role="admin">
            <Layout navItems={ADMIN_NAV} portalLabel="YEROME Portal" />
          </RequireRole>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/owners" element={<OwnersPage />} />
        <Route path="/admin/setup" element={<SetupOwnerPage />} />
        <Route path="/admin/owners/:ownerId" element={<OwnerDetailPage />} />
        <Route path="/admin/jobs" element={<JobsPage />} />
        <Route path="/admin/jobs/:jobId" element={<JobDetailPage />} />
        <Route path="/admin/costs" element={<CostsPage />} />
        <Route path="/admin/commissions" element={<CommissionsPage />} />
        <Route path="/admin/paychecks" element={<PaychecksPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/admin/audit" element={<AuditLogPage />} />
      </Route>

      <Route
        element={
          <RequireRole role="owner">
            <Layout navItems={OWNER_NAV} portalLabel="Owner Portal" />
          </RequireRole>
        }
      >
        <Route path="/owner" element={<OwnerDashboard />} />
        <Route path="/owner/jobs" element={<OwnerJobsPage />} />
        <Route path="/owner/jobs/:jobId" element={<OwnerJobDetailPage />} />
        <Route path="/owner/commissions" element={<OwnerCommissionsPage />} />
        <Route path="/owner/paychecks" element={<OwnerPaychecksPage />} />
      </Route>

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
