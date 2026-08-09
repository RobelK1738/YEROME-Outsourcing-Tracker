// Route guard. Redirects unauthenticated users to /login and enforces role.
// This is a UX convenience only — real authorization is enforced by RLS.

import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Loading } from './ui/Loading.jsx';

export function RequireRole({ role, children }) {
  const { loading, isAuthenticated, role: currentRole } = useAuth();
  const location = useLocation();

  if (loading) return <Loading full label="Checking your session…" />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (role && currentRole !== role) {
    // Signed in but wrong portal — send them to their own home.
    return <Navigate to={currentRole === 'admin' ? '/admin' : '/owner'} replace />;
  }
  return children;
}
