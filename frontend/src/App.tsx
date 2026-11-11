import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, PenLine, AtSign, ListChecks, Target, NotebookPen, FileBarChart, FolderLock, Settings as Cog, LogOut, Menu,
  Boxes, Inbox, ListTodo,
  Mail, Phone, Globe,
} from 'lucide-react';
import { BRAND } from './brand';
import { useAuth, Loading, ROLE_LABEL } from './lib';
import Notifications from './Notifications';
import Login from './pages/Login';
import FirstPassword from './pages/FirstPassword';
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
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import MyWork from './pages/MyWork';
import TasksDashboard from './pages/TasksDashboard';

type Item = { to: string; label: string; icon: typeof Boxes; end?: boolean };

function navFor(isAdmin: boolean): { group: string; items: Item[] }[] {
  const work: Item[] = isAdmin
    ? [
        { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
        { to: '/products', label: 'Products', icon: Boxes },
        { to: '/tasks', label: 'Tasks', icon: ListTodo },
        { to: '/my-work', label: 'My work', icon: Inbox },
      ]
    : [
        { to: '/', label: 'My work', icon: Inbox, end: true },
        { to: '/products', label: 'My products', icon: Boxes },
        { to: '/overview', label: 'Growth overview', icon: LayoutDashboard },
      ];
  return [
    { group: 'Work', items: work },
    { group: 'Every day', items: [
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
}

function Logo() {
  return <img src={BRAND.logo} alt="RTL" width={40} height={40} />;
}

function OrgCard() {
  return (
    <div className="org-card">
      <b>{BRAND.ceo}, {BRAND.ceoTitle}</b>
      <a href={`mailto:${BRAND.email}`} title={BRAND.email}><Mail /> <span>{BRAND.email}</span></a>
      <a href={BRAND.whatsapp} target="_blank" rel="noreferrer noopener"><Phone /> <span>{BRAND.phone}</span></a>
      <a href={BRAND.website} target="_blank" rel="noreferrer noopener"><Globe /> <span>{BRAND.websiteLabel}</span></a>
    </div>
  );
}

export default function App() {
  const { user, ready, logout, can } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);

  if (!ready) return <Loading />;
  if (!user) return <Login />;
  if (user.must_change_password && user.role === 'admin') return <FirstPassword />;
  const isAdmin = can('admin');

  return (
    <div className="shell">
      <div className="mobile-bar">
        <button onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={22} /></button>
        <img src={BRAND.logo} alt="" width={30} height={30} />
        <strong style={{ fontFamily: 'var(--font-display)', flex: 1 }}>Growth Desk for RTL</strong>
        <Notifications dark />
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 4 }}>
          <NavLink to="/" className="brand">
            <Logo />
            <div>
              <div className="brand-name">Growth Desk</div>
              <div className="brand-name"><span>for RTL</span></div>
            </div>
          </NavLink>
          <span className="desktop-only"><Notifications dark /></span>
        </div>
        <nav className="nav">
          {navFor(isAdmin).map((g) => (
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
        <OrgCard />
        <div className="sidebar-foot" style={{ marginTop: 0 }}>
          <div className="who">{user.name}</div>
          <div style={{ color: '#8e9bb0', fontSize: 12 }}>{ROLE_LABEL[user.role]}</div>
          <button onClick={logout}><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={isAdmin ? <Dashboard /> : <MyWork />} />
          <Route path="/overview" element={<Dashboard />} />
          <Route path="/my-work" element={<MyWork />} />
          <Route path="/queue" element={<Navigate to="/tasks" replace />} />
          <Route path="/tasks" element={isAdmin ? <TasksDashboard /> : <Navigate to="/" replace />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
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
