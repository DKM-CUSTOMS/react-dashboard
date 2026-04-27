import { createBrowserRouter } from 'react-router-dom';
import MainLayout from './layout/MainLayout';
import FlowDashboard from './pages/FlowDashboard';
import FlowInfo from './pages/FlowInfo';
import RequestFlow from './pages/RequestFlow';
import NotFound from './pages/NotFound';
import CustomsDashboard from './pages/statistics/CustomsDashboard';
import UserPerformanceDashboard from './pages/statistics/UserPerformanceDashboard';
import UserManagement from './pages/statistics/UserManagement';
import Profile from './pages/profile/Profile';
import EmailAssistant from './pages/ai-agents/EmailAssistant';
import ContainerWeightCheck from './pages/Containers/ContainerWeightCheck';
import ArrivalsTable from './pages/arrivals/ArrivalsTable';
import OutboundsTable from './pages/arrivals/OutboundsTable.jsx';
import ArrivalsGuide from './pages/arrivals/ArrivalsGuide';
import SendingFiscal from './pages/fiscal-representation/SendingFiscal';
import DeclarationsList from './pages/fiscal-representation/DeclarationsList';
import DocumentRequest from './pages/fiscal-representation/DocumentRequest';
import BestmingSignatures from './pages/fiscal-representation/BestmingSignatures';
import PipelineMonitoringPage from './pages/PipelineMonitoringPage.jsx';
import DkmBrainDashboard from './pages/monitoring/DkmBrainDashboard.jsx';
import ClientDrilldown from './pages/monitoring/ClientDrilldown.jsx';
import ShipmentDrilldown from './pages/monitoring/ShipmentDrilldown.jsx';
import ClientRuleDetail from './pages/monitoring/ClientRuleDetail.jsx';
import AiChatbotPage from './pages/statistics/AiChatbotPage.jsx';
import CustomsAiChatbotPage from './pages/statistics/CustomsAiChatbotPage.jsx';
import HrAiCapabilitiesPage from './pages/statistics/HrAiCapabilitiesPage.jsx';
import RequireRole from './components/auth/RequireRole';
import UserRolesPage from './pages/admin/UserRolesPage';
import FlowsPage from './pages/rules-flows/FlowsPage';
import FlowBuilderPage from './pages/rules-flows/FlowBuilderPage';
import RunFlowPage from './pages/rules-flows/RunFlowPage';

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
        path: 'statistics/user-management',
        element: withAccess(<UserManagement />, ['admin', 'Administrator']),
      },
      {
        path: 'statistics/ai-chat',
        element: withAccess(<AiChatbotPage />, ['developer', 'admin']),
      },
      {
        path: 'statistics/ai-guide',
        element: withAccess(<HrAiCapabilitiesPage />, ['admin', 'manager', 'Team Leader']),
      },
      {
        path: 'statistics/customs-agent',
        element: withAccess(<CustomsAiChatbotPage />, ['admin', 'manager', 'Team Leader', 'Administrator', 'Senior']),
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
      { path: 'arrivals', element: withAccess(<ArrivalsTable />, ['Arrivals Agent', 'admin', 'manager', 'Team Leader', 'Senior']) },
      { path: 'arrivals/guide', element: withAccess(<ArrivalsGuide />, ['Arrivals Agent', 'admin', 'manager', 'Team Leader', 'Senior']) },
      { path: 'arrivals/outbounds/:mrn', element: withAccess(<OutboundsTable />, ['Arrivals Agent', 'admin', 'manager', 'Team Leader', 'Senior']) },
      { path: 'fiscal/sending', element: withAccess(<SendingFiscal />, ['admin', 'manager', 'Team Leader', 'Administrator']) },
      { path: 'fiscal/declarations', element: withAccess(<DeclarationsList />, ['admin', 'manager', 'Team Leader', 'Administrator']) },
      { path: 'fiscal/generate-documents', element: withAccess(<DocumentRequest />, ['admin', 'manager', 'Team Leader', 'Administrator']) },
      { path: 'fiscal/bestming-signatures', element: withAccess(<BestmingSignatures />, ['admin', 'manager', 'Team Leader', 'Administrator']) },
      { path: 'monitoring/pipelines', element: withAccess(<PipelineMonitoringPage />, ['developer']) },
      { path: 'monitoring/brain', element: withAccess(<DkmBrainDashboard />, ['developer', 'admin']) },
      { path: 'monitoring/brain/client/:client_key', element: withAccess(<ClientDrilldown />, ['developer', 'admin']) },
      { path: 'monitoring/brain/shipment/:shipment_id', element: withAccess(<ShipmentDrilldown />, ['developer', 'admin']) },
      { path: 'monitoring/brain/client-rules/:client_key', element: withAccess(<ClientRuleDetail />, ['developer', 'admin', 'operator', 'manager']) },
      { path: 'admin/user-roles', element: withAccess(<UserRolesPage />, ['developer']) },

      // Rules & Flows Platform
      { path: 'rules/flows', element: withAccess(<FlowsPage />, ['admin', 'manager', 'Team Leader', 'Senior']) },
      { path: 'rules/flows/:flowId/builder', element: withAccess(<FlowBuilderPage />, ['admin', 'manager']) },
      { path: 'rules/run', element: withAccess(<RunFlowPage />, ['admin', 'manager', 'Team Leader', 'Senior', 'declarant']) },
    ],
    errorElement: <NotFound />,
  },
]);

export default router;