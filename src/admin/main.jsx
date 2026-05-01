import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';
import AdminErrorBoundary from './AdminErrorBoundary';
const el = document.getElementById('root');
if (!el) {
  throw new Error('Admin: #root fehlt in admin.html');
}

createRoot(el).render(
  <StrictMode>
    <AdminErrorBoundary>
      <AdminApp />
    </AdminErrorBoundary>
  </StrictMode>,
);
