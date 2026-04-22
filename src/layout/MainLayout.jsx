import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="min-h-screen">
      <Sidebar collapsed={collapsed} toggle={() => setCollapsed(!collapsed)} />
      <main className={`transition-all ease-in ${collapsed ? 'pl-16' : 'pl-64'}`}>
        <Outlet />
      </main>
    </div>
  );
}