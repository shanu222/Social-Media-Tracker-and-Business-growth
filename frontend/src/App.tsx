import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, PenLine, AtSign, ListChecks, Target, NotebookPen, FileBarChart, FolderLock, Settings as Cog, LogOut, Menu,
} from 'lucide-react';
import { useAuth, Loading } from './lib';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import DailyUpdate from './pages/DailyUpdate';
import Accounts from './pages/Accounts';
import AccountDetail from './pages/AccountDetail';
import Checklist from './pages/Checklist';
import Kpis from './pages/Kpis';
import Review from './pages/Review';
import Reports from './pages/Reports';
import ReportView from './pages/ReportView';
import Files from './pages/Files';
import Settings from './pages/Settings';

const NAV = [
  { group: 'Every day', items: [
    { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/update', label: 'Daily update', icon: PenLine },
    { to: '/checklist', label: 'Checklist', icon: ListChecks },
  ] },
  { group: 'Business', items: [
    { to: '/accounts', label: 'Accounts', icon: AtSign },
    { to: '/kpis', label: 'Targets & KPIs', icon: Target },
    { to: '/review', label: 'Monthly review', icon: NotebookPen },
    { to: '/reports', label: 'Reports', icon: FileBarChart },
    { to: '/files', label: 'Files', icon: FolderLock },
  ] },
];

function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#24324a" />
      <rect x="7" y="18" width="4" height="7" rx="1" fill="#5FC9A8" />
      <rect x="14" y="13" width="4" height="12" rx="1" fill="#5FC9A8" />
      <rect x="21" y="7" width="4" height="18" rx="1" fill="#5FC9A8" />
    </svg>
  );
}

export default function App() {
  const { user, ready, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  if (!ready) return <Loading />;
  if (!user) return <Login />;

  return (
    <div className="shell">
      <div className="mobile-bar">
        <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
        <strong style={{ fontFamily: 'var(--font-display)' }}>Growth Desk</strong>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <NavLink to="/" className="brand">
          <Logo />
          <div>
            <div className="brand-name">Growth Desk</div>
            <div className="brand-sub">Social & business tracker</div>
          </div>
        </NavLink>
        <nav className="nav">
          {NAV.map((g) => (
            <div key={g.group} className="nav">
              <div className="nav-group">{g.group}</div>
              {g.items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end}>
                  <Icon /> {label}
                </NavLink>
              ))}
            </div>
          ))}
          <div className="nav-group">Account</div>
          <NavLink to="/settings"><Cog /> Settings</NavLink>
        </nav>
        <div className="sidebar-foot">
          <div className="who">{user.name}</div>
          <div style={{ color: '#8e9bb0', fontSize: 12 }}>{user.email} · {user.role}</div>
          <button onClick={logout}><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/update" element={<DailyUpdate />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/:id" element={<AccountDetail />} />
          <Route path="/checklist" element={<Checklist />} />
          <Route path="/kpis" element={<Kpis />} />
          <Route path="/review" element={<Review />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:id" element={<ReportView />} />
          <Route path="/files" element={<Files />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
