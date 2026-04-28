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
        background: 'linear-gradient(180deg, #FFE4CC 0%, #FAD2B0 55%, #F5BE92 100%)',
        boxShadow: 'inset -1px 0 0 rgba(255,255,255,.4), 6px 0 28px rgba(200,120,60,.12), 2px 0 0 rgba(200,120,60,.08)',
        borderRight: '1px solid #F5BE92',
      }}
    >
      {/* 侧边栏顶部柔光 */}
      <div className="absolute top-0 left-0 right-0 h-[180px] pointer-events-none" style={{
        background: 'radial-gradient(ellipse at top, rgba(255,255,255,.4) 0, transparent 70%)'
      }}></div>

      {/* Logo 区域 */}
      <div className="flex items-center justify-center h-20 mt-4 mb-2 cursor-pointer relative z-10" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="relative flex items-center justify-center w-12 h-12 bg-gradient-to-br from-[#F9B98A] via-[#F2935A] to-[#E07338] rounded-xl shadow-lg"
          style={{ boxShadow: '0 6px 16px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.4)' }}>
          <ShieldCheck className="text-white w-7 h-7" />
          <HeartPulse className="absolute text-white w-4 h-4 mt-1" style={{ filter: 'drop-shadow(0 0 4px rgba(255,255,255,.8))' }} />
        </div>
        {!isCollapsed && <span className="ml-3 text-xl font-bold tracking-wider text-[#3A2E26]">VIS4SRD</span>}
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
                  ? 'bg-white text-[#E07338] font-semibold shadow-md' 
                  : 'text-[#5C4E42] hover:bg-white/50 hover:text-[#3A2E26]'
              }`}
              style={isActive ? { boxShadow: '0 4px 14px rgba(200,120,60,.18)' } : {}}
            >
              {/* 选中态左侧高亮条 */}
              {isActive && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r"
                  style={{
                    background: 'linear-gradient(180deg, #F2935A, #E07338)',
                    boxShadow: '0 0 10px rgba(242,147,90,.6)'
                  }}></div>
              )}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mx-3 flex-shrink-0 transition-all duration-200 ${ // mx-3 改为 ml-3 mr-4 增加间距
                isActive 
                  ? 'bg-gradient-to-br from-[#FBD9BE] to-[#F2935A] text-white' 
                  : 'bg-white/45 text-[#5C4E42] group-hover:bg-white/85'
              }`}
                style={isActive ? { boxShadow: '0 4px 10px rgba(200,120,60,.28)' } : { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.5)' }}
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
          <div className="flex items-center gap-3 p-3 rounded-xl bg-white/55 border border-white/70 shadow-sm">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#F9B98A] to-[#E07338] flex items-center justify-center text-white text-sm font-semibold shadow-md">
              😊
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#3A2E26]">你好,朋友</p>
              <p className="text-xs text-[#8A6F58]">今天也来了</p>
            </div>
            <div className="w-2 h-2 rounded-full bg-[#7FE0B7] shadow-[0_0_6px_#7FE0B7]"></div>
          </div>
        )}
      </div>
      
      {/* 版本号 */}
      <div className="text-center pb-4 pt-2 text-xs text-[#8A6F58] relative z-10">
        {!isCollapsed ? '每一次打开,都是温柔的勇气' : ''} v1.0
      </div>
    </div>
  );
}
