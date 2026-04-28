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
    <div className="flex h-screen font-sans selection:bg-orange-200" style={{
      background: 'linear-gradient(180deg, #FFF7EE 0%, #FFF7EE 100%)'
    }}>
      <Sidebar
        activeTab={activeTab}
        onNavClick={handleNavClick}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        isMapPage={location.pathname.includes('/map')}
      />

      {/* 右侧区域：全屏相对定位，内部由 header/main 分别占据独立堆叠层级 */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* 装饰层（极淡暖色点阵纹理） */}
        <div className="absolute inset-0 pointer-events-none z-0" style={{
          backgroundImage: 'radial-gradient(rgba(242,147,90,.06) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,.5), transparent 60%)',
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,.5), transparent 60%)'
        }}></div>

        {/* 右侧装饰光晕 */}
        <div className="absolute right-0 bottom-0 w-64 h-64 pointer-events-none z-0" style={{
          background: 'radial-gradient(circle at 100% 100%, rgba(157,189,217,.08) 0%, transparent 30%)'
        }}></div>
        <div className="absolute left-0 bottom-0 w-48 h-48 pointer-events-none z-0" style={{
          background: 'radial-gradient(circle at 0% 100%, rgba(126,184,142,.06) 0%, transparent 30%)'
        }}></div>

        {/* TopBar：独立最高层级，绝对固定在顶部 */}
        <TopBar
          isCollapsed={isCollapsed}
          setIsCollapsed={setIsCollapsed}
        />

        {/* 主内容区：独立堆叠层级，低于 TopBar */}
        <main className={`flex flex-1 flex-col min-h-0 overflow-x-hidden custom-scrollbar relative ${
          location.pathname.includes('/map') ? 'p-0 overflow-hidden' : 'p-4 md:p-6 lg:p-8 overflow-y-auto'
        }`}>
          {/* 页面根节点：地图页用 absolute 填满以避免底部空隙 */}
          <div className={`w-full ${location.pathname.includes('/map') ? 'relative flex-1 min-h-0 h-full' : 'flex flex-1 flex-col min-h-0'}`}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
