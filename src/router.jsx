import { createBrowserRouter } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import FlowDashboard from './pages/FlowDashboard';
import FlowInfo from './pages/FlowInfo';
import RequestFlow from './pages/RequestFlow';
import NotFound from './pages/NotFound';
import CustomsDashboard from './pages/statistics/CustomsDashboard';
import UserPerformanceDashboard from './pages/statistics/UserPerformanceDashboard';
import UserCompareDashboard from './pages/statistics/UserCompareDashboard';
import MultiUserCompareDashboard from './pages/statistics/MultiUserCompareDashboard';
import UserComparisonSelector from './pages/statistics/UserComparisonSelector.jsx';
import MonthlyReport from './pages/statistics/MonthlyReport';
import Profile from './pages/profile/Profile';
import EmailAssistant from './pages/ai-agents/EmailAssistant';
import ContainerWeightCheck from './pages/Containers/ContainerWeightCheck';
import ArrivalsTable from './pages/arrivals/ArrivalsTable';
import OutboundsTable from './pages/arrivals/OutboundsTable.jsx';
import SendingFiscal from './pages/fiscal-representation/SendingFiscal';
import DeclarationsList from './pages/fiscal-representation/DeclarationsList';
import DocumentRequest from './pages/fiscal-representation/DocumentRequest'; // Added
import RequireRole from './components/auth/RequireRole';

const withAccess = (element, allowedRoles) => (
  <RequireRole allowed={allowedRoles}>{element}</RequireRole>
);

const router = createBrowserRouter([
  {
    path: '/',
    element: <MainLayout />,
    children: [
      {
        path: 'uploads/flows',
        element: withAccess(<FlowDashboard />, ['admin', 'manager', 'Team Leader', 'Senior']),
      },
      {
        path: 'uploads/flows/request',
        element: withAccess(<RequestFlow />, ['admin', 'manager', 'Team Leader', 'Senior']),
      },
      {
        path: 'uploads/flows/informations',
        element: withAccess(<FlowInfo />, ['admin', 'manager', 'Team Leader', 'Senior']),
      },
      {
        path: 'statistics/performance',
        element: withAccess(<CustomsDashboard />, ['admin', 'Team Leader']),
      },
      {
        path: 'statistics/performance/:username',
        element: withAccess(<UserPerformanceDashboard />, ['admin', 'Team Leader']),
      },
      {
        path: 'statistics/performance/compare',
        element: withAccess(<UserComparisonSelector />, ['admin', 'Team Leader']),
      },
      {
        path: 'statistics/performance/compare/:user1/:user2',
        element: withAccess(<UserCompareDashboard />, ['admin', 'Team Leader']),
      },
      {
        path: 'statistics/performance/compare-multi/:usernames',
        element: withAccess(<MultiUserCompareDashboard />, ['admin', 'Team Leader']),
      },
      {
        path: 'statistics/monthly-report',
        element: withAccess(<MonthlyReport />, ['admin', 'Team Leader']),
      },
      { path: 'settings/profile', element: withAccess(<Profile />, ['authenticated']) },
      {
        path: 'ai-agents/email-assistant',
        element: withAccess(<EmailAssistant />, ['admin', 'manager', 'Team Leader', 'Senior']),
      },
      {
        path: 'container-weight-check',
        element: withAccess(<ContainerWeightCheck />, ['admin', 'manager', 'Team Leader', 'Senior']),
      },
      { path: 'arrivals', element: withAccess(<ArrivalsTable />, ['user', 'admin', 'manager', 'Team Leader', 'Senior']) },
      { path: 'arrivals/outbounds/:mrn', element: withAccess(<OutboundsTable />, ['user', 'admin', 'manager', 'Team Leader', 'Senior']) },
      { path: 'fiscal/sending', element: withAccess(<SendingFiscal />, ['admin', 'manager', 'Team Leader', 'Administrator']) },
      { path: 'fiscal/declarations', element: withAccess(<DeclarationsList />, ['admin', 'manager', 'Team Leader', 'Administrator']) },
      { path: 'fiscal/generate-documents', element: withAccess(<DocumentRequest />, ['admin', 'manager', 'Team Leader', 'Administrator']) }, // Added
    ],
    errorElement: <NotFound />,
  },
]);

export default router;