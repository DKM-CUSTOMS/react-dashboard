import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  Upload,
  Truck,
  BarChart3,
  ChevronRight,
  Settings,
  HelpCircle,
  Container,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// Custom hook to detect mobile
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkScreen = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkScreen();
    window.addEventListener('resize', checkScreen);
    return () => window.removeEventListener('resize', checkScreen);
  }, []);

  return isMobile;
};

const Sidebar = ({ collapsed, toggle }) => {
  const isMobile = useIsMobile();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedItems, setExpandedItems] = useState({});
  const [hoveredItem, setHoveredItem] = useState(null);
  const [activePanel, setActivePanel] = useState(null);
  const { user, loading, hasRole } = useAuth();

  const toggleExpanded = (itemId) => {
    setExpandedItems((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const menuItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: LayoutDashboard,
      path: '/',
      allowedRoles: ['admin', 'manager', 'Team Leader', 'Senior'],
      subtitles: [
        { label: 'Overview', path: '/overview' },
        { label: 'Analytics', path: '/analytics' },
        { label: 'Reports', path: '/reports' },
      ],
    },
    {
      id: 'containers',
      label: 'Containers',
      icon: Container,
      path: '/container-weight-check',
      allowedRoles: ['admin', 'manager', 'Team Leader', 'Senior'],
      subtitles: [
        { label: 'Weight Violations', path: '/container-weight-check' },
      ],
      hasSubmenu: true,
    },
    {
      id: 'arrivals',
      label: 'Arrivals',
      icon: Truck,
      path: '/arrivals',
      allowedRoles: ['user', 'admin', 'manager', 'Team Leader', 'Senior'],
      subtitles: [
        { label: 'Arrivals', path: '/arrivals' },
      ],
      hasSubmenu: true,
    },
    {
      id: 'uploads',
      label: 'Uploads',
      icon: Upload,
      path: '/uploads/flows',
      allowedRoles: ['admin', 'manager', 'Team Leader', 'Senior'],
      subtitles: [
        { label: 'Flows', path: '/uploads/flows' },
        { label: 'Informations', path: '/uploads/flows/informations' },
        { label: 'Request Upload', path: '/uploads/flows/request' },
      ],
      hasSubmenu: true,
    },
    {
      id: 'statistics',
      label: 'Statistics',
      icon: BarChart3,
      path: '/statistics/performance',
      allowedRoles: ['admin', 'manager', 'Team Leader'],
      subtitles: [
        { label: 'Performance', path: '/statistics/performance' },
        { label: 'Compare', path: '/statistics/performance/compare' },
        { label: 'Monthly Report', path: '/statistics/monthly-report' },
      ],
      hasSubmenu: true,
    },
  ];

  const otherItems = [
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      path: '/settings',
      allowedRoles: ['authenticated'],
      subtitles: [
        { label: 'Profile', path: '/settings/profile' },
        { label: 'Preferences', path: '/settings/preferences' },
        { label: 'Security', path: '/settings/security' },
      ],
      hasSubmenu: true,
    },
    {
      id: 'help',
      label: 'Help',
      icon: HelpCircle,
      path: '/help',
      allowedRoles: ['authenticated'],
      subtitles: [
        { label: 'Documentation', path: '/help/documentation' },
        { label: 'Support', path: '/help/support' },
        { label: 'FAQ', path: '/help/faq' },
      ],
      hasSubmenu: true,
    },
  ];

  // Helper to check access
  const checkAccess = (item) => {
    if (!item.allowedRoles) return true; // Default to visible if no roles specified
    return item.allowedRoles.some(role => hasRole(role));
  };

  const filteredMenuItems = menuItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) && checkAccess(item)
  );

  const filteredOtherItems = otherItems.filter((item) =>
    item.label.toLowerCase().includes(searchQuery.toLowerCase()) && checkAccess(item)
  );

  const renderMenuItem = (item, isInOthersSection = false) => {
    const isExpanded = expandedItems[item.id];
    const isHovered = hoveredItem === item.id;
    const showSubtitles = (collapsed && isHovered) || (!collapsed && isExpanded);

    return (
      <div key={item.id} className="relative">
        <NavLink
          to={item.path}
          end
          className={({ isActive }) => `
            flex items-center justify-between px-3 py-2 mx-2 rounded-lg
            transition-all duration-200 group cursor-pointer relative
            ${isActive
              ? 'bg-primary text-white'
              : 'hover:bg-gray-50 text-text-primary'
            }
            ${isExpanded && !isActive ? 'bg-gray-50' : ''}
          `}
          onClick={(e) => {
            if (!collapsed && item.hasSubmenu) {
              e.preventDefault();
              toggleExpanded(item.id);
            }
          }}
          onMouseEnter={() => setHoveredItem(item.id)}
          onMouseLeave={() => {
            setTimeout(() => {
              if (hoveredItem === item.id) {
                setHoveredItem(null);
              }
            }, 200);
          }}
        >
          {({ isActive }) => (
            <>
              <div className="flex items-center space-x-3">
                <item.icon
                  size={20}
                  className={`${isActive
                    ? 'text-white'
                    : 'text-text-muted group-hover:text-primary'
                    }`}
                />
                {!collapsed && (
                  <span
                    className={`font-medium ${isActive ? 'text-white' : 'text-text-primary'
                      }`}
                  >
                    {item.label}
                  </span>
                )}
              </div>

              {!collapsed && item.hasSubmenu && (
                <ChevronRight
                  size={16}
                  className={`
                    transform transition-transform duration-200
                    ${isExpanded ? 'rotate-90' : ''}
                    ${isActive
                      ? 'text-white'
                      : 'text-text-muted group-hover:text-primary'
                    }
                  `}
                />
              )}
            </>
          )}
        </NavLink>

        {/* Submenu (Desktop only) */}
        {!collapsed && showSubtitles && item.hasSubmenu && (
          <div className="ml-6 mt-1 space-y-1">
            {item.subtitles.map((subtitle, index) => (
              <NavLink
                key={index}
                to={subtitle.path}
                className={({ isActive }) => `
                  flex items-center px-3 py-1 text-sm rounded
                  transition-colors
                  ${isActive
                    ? 'text-primary font-medium'
                    : 'text-text-muted hover:text-primary hover:bg-gray-50'
                  }
                `}
              >
                {subtitle.label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ======================
  // MOBILE: Bottom Navigation
  // ======================
  if (isMobile) {
    return (
      <>
        {/* Bottom Bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-border shadow-lg z-50">
          <div className="flex items-center h-16 overflow-x-auto no-scrollbar px-2">
            {[...filteredMenuItems, ...filteredOtherItems].map((item) => (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                className="flex flex-col items-center justify-center p-2 min-w-[70px] flex-shrink-0 text-text-muted hover:text-primary"
              >
                <item.icon size={22} />
                <span className="text-xs mt-1 whitespace-nowrap">{item.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Slide-Up Panel */}
        {activePanel && (
          <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end"
            onClick={() => setActivePanel(null)}
          >
            <div
              className="bg-white w-full max-h-96 rounded-t-2xl shadow-lg transform transition-transform duration-300 ease-in-out"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-text-primary">
                  {
                    [...menuItems, ...otherItems].find((i) => i.id === activePanel)
                      ?.label
                  }
                </h3>
                <button
                  onClick={() => setActivePanel(null)}
                  className="p-2 rounded-full hover:bg-gray-100"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
                {[
                  ...menuItems.find((i) => i.id === activePanel)?.subtitles || [],
                  ...otherItems.find((i) => i.id === activePanel)?.subtitles || [],
                ].map((sub, idx) => (
                  <NavLink
                    key={idx}
                    to={sub.path}
                    className="block py-2 px-4 rounded hover:bg-gray-100 text-text-muted"
                    onClick={() => setActivePanel(null)}
                  >
                    {sub.label}
                  </NavLink>
                ))}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // ======================
  // DESKTOP: Original Sidebar
  // ======================
  return (
    <div
      className={`
      ${collapsed ? 'w-16' : 'w-64'} 
      bg-white border-r border-border h-screen flex flex-col transition-all duration-300 fixed
    `}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9">
            <img
              src="/images/cropped-DKM-Embleem-192x192.png"
              alt="DKM Logo"
              className="w-full h-full object-contain"
            />
          </div>
          {!collapsed && (
            <span className="font-bold text-primary text-lg font-mono">DKM </span>
          )}
        </div>
        <button
          onClick={toggle}
          className="p-1 rounded transition-colors"
        >
          <ChevronRight
            size={20}
            className={`text-white transform transition-transform duration-200 bg-primary rounded-md  ${collapsed ? '' : 'rotate-180'
              }`}
          />
        </button>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-border">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 transform -translate-y-1/2 text-text-muted"
          />
          <input
            type="text"
            placeholder={collapsed ? '' : 'Search'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`
              w-full pl-10 pr-4 py-2 border border-border rounded-lg 
              focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
              text-sm placeholder-text-muted
              ${collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}
            `}
          />
        </div>
      </div>

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto overflow-x-visible">
        <div className="py-4">
          {!collapsed && (
            <div className="px-4 mb-2">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Menu
              </span>
            </div>
          )}
          <div className="space-y-1">
            {filteredMenuItems.map((item) => renderMenuItem(item))}
          </div>
        </div>

        {/* Others Section */}
        <div className="py-4 border-t border-border">
          {!collapsed && (
            <div className="px-4 mb-2">
              <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Others
              </span>
            </div>
          )}
          <div className="space-y-1">
            {filteredOtherItems.map((item) => renderMenuItem(item, true))}
          </div>
        </div>
      </div>

      {/* User Profile */}
      {!loading && user && (
        <div className="p-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
              <span className="text-text-muted font-medium text-sm">
                {user.name.split(' ')[0][0]}
                {user.name.split(' ')[1]?.[0] || ''}
              </span>
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text-primary text-sm truncate">
                  {user.name}
                </div>
                <div className="text-text-muted text-xs truncate">
                  {user.email}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Sidebar;