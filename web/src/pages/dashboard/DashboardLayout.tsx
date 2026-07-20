import { NavLink, Outlet } from 'react-router-dom';
import './dashboard.css';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { AgentStatusFooter } from './AgentStatusFooter';
import { logout } from '../../api';

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Conversations', end: true },
  { to: '/dashboard/appointments', label: 'Appointments', end: false },
  { to: '/dashboard/settings', label: 'Settings', end: false },
];

export function DashboardLayout() {
  const { me, loading, error } = useRequireAuth();

  if (loading) {
    return (
      <div className="dashboard-shell">
        <div className="dashboard-main">
          <div className="skeleton" style={{ height: '2rem', width: '12rem', marginBottom: '1rem' }} />
          <div className="skeleton" style={{ height: '20rem' }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-shell">
        <div className="dashboard-main">
          <div className="error-banner" role="alert">
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <a href="/" className="brand">
          RingBack
        </a>
        <nav aria-label="Dashboard navigation">
          <ul className="dashboard-nav">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <AgentStatusFooter />
        {me ? (
          <div className="dashboard-sidebar-footer">
            <span className="session-email">{me.email}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ paddingLeft: 0 }}
              onClick={() => {
                logout().finally(() => {
                  window.location.href = '/login';
                });
              }}
            >
              Log out
            </button>
          </div>
        ) : null}
      </aside>
      <main className="dashboard-main">
        <Outlet />
      </main>
    </div>
  );
}
