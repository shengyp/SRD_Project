import { useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  { id: 'home', label: '首页' },
  { id: 'model', label: '模型中心' },
  { id: 'knowledge', label: '知识库' },
  { id: 'chat', label: '智能问答' },
  { id: 'archive', label: '心理档案' },
  { id: 'scale', label: '心理量表' },
  { id: 'risk', label: '自杀风险检测' },
  { id: 'map', label: '心理援助地图' },
]

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(false)

  const activeTab = NAV_ITEMS.find(item => location.pathname.includes(item.id))?.id || 'home'

  const handleNavClick = (id: string) => {
    navigate(`/${id}`)
  }

  return (
    <div className="flex h-screen font-sans selection:bg-blue-100 bg-[#F5F7FB]">
      <Sidebar
        activeTab={activeTab}
        onNavClick={handleNavClick}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        isMapPage={location.pathname.includes('/map')}
      />

      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        <TopBar
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
        />

        <main className={`flex flex-1 flex-col min-h-0 overflow-x-hidden custom-scrollbar relative ${
          location.pathname.includes('/map') ? 'p-0 overflow-hidden' : 'px-4 py-4 md:px-6 md:py-5 lg:px-8 lg:py-6 overflow-y-auto'
        }`}>
          <div className={`w-full ${location.pathname.includes('/map') ? 'relative flex-1 min-h-0 h-full' : 'flex flex-1 flex-col min-h-0'}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
