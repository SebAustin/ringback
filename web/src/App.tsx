import { Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Demo } from './pages/Demo';
import { Ops } from './pages/Ops';
import { Login } from './pages/Login';
import { Welcome } from './pages/Welcome';
import { DashboardLayout } from './pages/dashboard/DashboardLayout';
import { ConversationsList } from './pages/dashboard/ConversationsList';
import { ConversationDetail } from './pages/dashboard/ConversationDetail';
import { Settings } from './pages/dashboard/Settings';
import { Appointments } from './pages/dashboard/Appointments';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/ops" element={<Ops />} />
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<Welcome />} />
      <Route path="/dashboard" element={<DashboardLayout />}>
        <Route index element={<ConversationsList />} />
        <Route path="conversations/:id" element={<ConversationDetail />} />
        <Route path="settings" element={<Settings />} />
        <Route path="appointments" element={<Appointments />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
