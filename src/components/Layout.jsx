// Shared application shell: sidebar navigation on desktop, and on phones a
// contextual top bar plus a bottom tab bar (with a "More" drawer for the
// remaining destinations). Used by both portals via nested routes (<Outlet/>).

import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Logo } from './ui/Logo.jsx';
import { APP_NAME } from '../lib/constants.js';

// Longest matching nav item wins so detail routes still highlight their section.
function activeItem(navItems, pathname) {
  let best = null;
  for (const item of navItems) {
    const isMatch = item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
    if (isMatch && (!best || item.to.length > best.to.length)) best = item;
  }
  return best;
}

export function Layout({ navItems, portalLabel }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { user, isAdmin, signOut } = useAuth();
  const location = useLocation();

  const displayName = isAdmin
    ? user?.email || 'YEROME'
    : user?.user_metadata?.display_name || user?.user_metadata?.username || 'Owner';

  const current = activeItem(navItems, location.pathname);
  const primaryItems = navItems.filter((item) => item.primary);
  const tabItems = (primaryItems.length ? primaryItems : navItems).slice(0, 4);
  const hasOverflow = tabItems.length < navItems.length;

  // Close the drawer on navigation and lock background scroll while it is open.
  useEffect(() => setDrawerOpen(false), [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const nav = (
    <nav className="sidebar__nav" aria-label="Primary">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-link ${isActive ? 'nav-link--active' : ''}`}
          onClick={() => setDrawerOpen(false)}
        >
          <span className="nav-link__icon" aria-hidden="true">
            {item.icon}
          </span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Logo size={28} className="sidebar__logo" />
          <div>
            <div className="sidebar__brand-name">{APP_NAME}</div>
            <div className="sidebar__portal">{portalLabel}</div>
          </div>
        </div>
        {nav}
        <div className="sidebar__footer">
          <div className="sidebar__user">
            <div className="sidebar__user-name">{displayName}</div>
            <div className="sidebar__user-role">{isAdmin ? 'YEROME' : 'Owner'}</div>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar — shows where you are, not just the brand */}
      <header className="topbar">
        <Logo size={24} className="topbar__logo" />
        <div className="topbar__title">
          <span className="topbar__title-text">{current?.label || portalLabel}</span>
          <span className="topbar__portal">{portalLabel}</span>
        </div>
        <button
          type="button"
          className="btn btn--ghost btn--sm topbar__signout"
          onClick={signOut}
        >
          Sign out
        </button>
      </header>

      {/* Mobile drawer (opened from the bottom bar's "More" tab) */}
      {drawerOpen ? (
        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Navigation menu">
            <div className="drawer__head">
              <div className="drawer__brand">
                <Logo size={24} className="sidebar__logo" />
                <div>
                  <div className="sidebar__brand-name">{APP_NAME}</div>
                  <div className="sidebar__portal">{portalLabel}</div>
                </div>
              </div>
              <button
                type="button"
                className="modal__close drawer__close"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
              >
                ×
              </button>
            </div>
            {nav}
            <div className="sidebar__footer drawer__footer">
              <div className="sidebar__user">
                <div className="sidebar__user-name">{displayName}</div>
                <div className="sidebar__user-role">{isAdmin ? 'YEROME' : 'Owner'}</div>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="content" key={location.pathname.split('/').slice(0, 3).join('/')}>
        <div className="content__inner">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="bottom-nav" aria-label="Sections">
        {tabItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `bottom-nav__tab ${isActive ? 'bottom-nav__tab--active' : ''}`}
          >
            <span className="bottom-nav__icon" aria-hidden="true">{item.icon}</span>
            <span className="bottom-nav__label">{item.shortLabel || item.label}</span>
          </NavLink>
        ))}
        {hasOverflow ? (
          <button
            type="button"
            className={`bottom-nav__tab ${current && !tabItems.includes(current) ? 'bottom-nav__tab--active' : ''}`}
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
          >
            <span className="bottom-nav__icon" aria-hidden="true">⋯</span>
            <span className="bottom-nav__label">More</span>
          </button>
        ) : null}
      </nav>
    </div>
  );
}
