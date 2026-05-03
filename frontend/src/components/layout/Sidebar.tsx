import { 
  Home, 
  Settings, 
  BookOpen, 
  MessageCircle, 
  UserSquare2, 
  ListChecks, 
  ShieldCheck, 
  MapPin,
  HeartPulse,
} from 'lucide-react';

interface NavItem {
  id: string;
  icon: React.ComponentType<any>;
  label: string;
}

interface SidebarProps {
  activeTab: string;
  onNavClick: (id: string) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMapPage?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: Home, label: '首页' },
  { id: 'model', icon: Settings, label: '模型中心' },
  { id: 'knowledge', icon: BookOpen, label: '知识库' },
  { id: 'chat', icon: MessageCircle, label: '智能问答' },
  { id: 'archive', icon: UserSquare2, label: '心理档案' },
  { id: 'scale', icon: ListChecks, label: '心理量表' },
  { id: 'risk', icon: ShieldCheck, label: '自杀风险检测' },
  { id: 'map', icon: MapPin, label: '心理援助地图' },
];

export default function Sidebar({ activeTab, onNavClick, isCollapsed, setIsCollapsed, isMapPage }: SidebarProps) {
  return (
    <div 
      className={`relative flex flex-col transition-all duration-300 ease-in-out overflow-visible z-20 ${
        isMapPage ? 'rounded-br-none' : 'rounded-br-3xl rounded-tr-3xl'
      } ${isCollapsed ? 'w-20' : 'w-64'}`}
      style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,253,0.98) 100%)',
        boxShadow: '0 18px 44px rgba(15,23,42,.06)',
        borderRight: '1px solid #E2E8F0',
      }}
    >
      {/* 侧边栏顶部柔光 */}
      <div className="absolute top-0 left-0 right-0 h-[180px] pointer-events-none" style={{
        background: 'radial-gradient(ellipse at top, rgba(132,165,229,.16) 0, transparent 72%)'
      }}></div>

      {/* Logo 区域 */}
      <div className="flex items-center justify-center h-20 mt-4 mb-2 cursor-pointer relative z-10" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl shadow-lg"
          style={{ background: 'linear-gradient(135deg, #7EA8FF, #2F6BFF 55%, #1D4ED8 100%)', boxShadow: '0 10px 24px rgba(47,107,255,.22), inset 0 1px 0 rgba(255,255,255,.28)' }}>
          <ShieldCheck className="text-white w-7 h-7" />
          <HeartPulse className="absolute text-white w-4 h-4 mt-1" style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,.58))' }} />
        </div>
        {!isCollapsed && <span className="ml-3 text-xl font-bold tracking-wide text-[#162033]">VIS4SRD</span>}
      </div>

      {/* 导航菜单 */}
      <nav className="flex-1 px-4 py-6 space-y-3 overflow-visible min-h-0 relative z-10">
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onNavClick(item.id)}
              className={`flex items-center w-full rounded-2xl transition-all duration-200 group relative py-2.5 ${ // 增加 py-2.5 内边距
                isActive 
                  ? 'bg-[#EEF4FF] text-[#1D4ED8] font-semibold shadow-sm' 
                  : 'text-[#516276] hover:bg-[#F5F8FC] hover:text-[#162033]'
              }`}
              style={isActive ? { boxShadow: '0 8px 18px rgba(47,107,255,.10)' } : {}}
            >
              {/* 选中态左侧高亮条 */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r"
                  style={{
                    background: 'linear-gradient(180deg, #2F6BFF, #1D4ED8)',
                    boxShadow: '0 0 10px rgba(47,107,255,.32)'
                  }}></div>
              )}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mx-3 flex-shrink-0 transition-all duration-200 ${ // mx-3 改为 ml-3 mr-4 增加间距
                isActive 
                  ? 'bg-gradient-to-br from-[#89ACFF] to-[#2F6BFF] text-white' 
                  : 'bg-white text-[#64748B] group-hover:bg-[#EDF3FB]'
              }`}
                style={isActive ? { boxShadow: '0 8px 16px rgba(47,107,255,.22)' } : { boxShadow: 'inset 0 0 0 1px rgba(226,232,240,.9)' }}
              >
                <Icon className="w-5 h-5" />
              </div>
              {!isCollapsed && <span className="mr-3 truncate">{item.label}</span>}
            </button>
          );
        })}
      </nav>
      
      {/* 底部用户卡 */}
      <div className="p-4 mt-auto relative z-10">
        {!isCollapsed && (
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-white border border-[#E2E8F0] shadow-sm">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#93B7FF] to-[#2F6BFF] flex items-center justify-center text-white text-sm font-semibold shadow-md">
              心
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#162033]">系统在线</p>
              <p className="text-xs text-[#6B7A90]">风险识别与证据推理已就绪</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-[#1F9D72] shadow-[0_0_8px_rgba(31,157,114,.45)]"></div>
          </div>
        )}
      </div>
      
      {/* 版本号 */}
      <div className="text-center pb-4 pt-2 text-xs text-[#94A3B8] relative z-10">
        {!isCollapsed ? 'Demo Paper · 风险检测研究系统' : ''} v1.0
      </div>
    </div>
  );
}
