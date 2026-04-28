import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Menu, ChevronRight, User, LogOut, KeyRound, UserCog, X, Loader2, Check } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { logout, fetchMe, updateProfile, changePassword } from '../../api';
import { useAuthStore } from '../../store/authStore';
import type { AuthUser } from '../../types';

interface TopBarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

const NAV_ITEMS = [
  { id: 'home', label: '首页', path: '/home' },
  { id: 'model', label: '模型中心', path: '/model' },
  { id: 'knowledge', label: '知识库', path: '/knowledge' },
  { id: 'chat', label: '智能问答', path: '/chat' },
  { id: 'archive', label: '心理档案', path: '/archive' },
  { id: 'scale', label: '心理量表', path: '/scale' },
  { id: 'risk', label: '自杀风险检测', path: '/risk' },
  { id: 'map', label: '心理援助地图', path: '/map' },
];

const SUB_PAGES: Record<string, { path: string; label: string }[]> = {
  home: [{ path: '/home', label: '首页' }],
  model: [
    { path: '/model', label: '模型管理' },
    { path: '/model/template', label: '指令模板管理' },
  ],
  knowledge: [
    { path: '/knowledge', label: '知识库管理' },
    { path: '/knowledge/detail', label: '文档详情' },
  ],
  chat: [
    { path: '/chat', label: '智能问答' },
    { path: '/doc-preview', label: '文档预览' },
  ],
  archive: [
    { path: '/archive', label: '心理档案' },
    { path: '/archive/detail', label: '用户档案详情' },
  ],
  scale: [
    { path: '/scale', label: '心理量表' },
    { path: '/scale/answer', label: '答题中' },
    { path: '/scale/result', label: '评估结果' },
  ],
  risk: [{ path: '/risk', label: '自杀风险检测' }],
  map: [{ path: '/map', label: '心理援助地图' }],
};

/** 动态用户头像 */
function UserAvatar({ user, size = 'md' }: { user: AuthUser; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-8 h-8 text-sm';
  const iconClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div
      className={`${sizeClass} rounded-full flex items-center justify-center border-2 border-white shadow-sm shrink-0 text-white font-medium`}
      style={{ background: `linear-gradient(135deg, #F2935A, #E07338)` }}
      title={user.nickname}
      aria-hidden
    >
      <User className={iconClass} strokeWidth={2.25} />
    </div>
  );
}


/** 修改资料弹窗 */
function ProfileModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { updateUser } = useAuthStore();
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMsg(null);
      fetchMe()
        .then((u) => setNickname(u.nickname || u.username))
        .catch(() => setNickname(''));
    }
  }, [isOpen]);

  const handleSave = async () => {
    if (!nickname.trim()) {
      setMsg({ type: 'err', text: '昵称不能为空' });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      await updateProfile(nickname.trim());
      updateUser({ nickname: nickname.trim() });
      setMsg({ type: 'ok', text: '资料更新成功' });
      setTimeout(onClose, 1200);
    } catch (err: unknown) {
      const e = err instanceof Error ? err.message : '保存失败';
      setMsg({ type: 'err', text: e });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scale-in overflow-hidden border border-[#F5D9C0] pointer-events-auto">
        {/* 顶部渐变条 - 暖橙色主题 */}
        <div className="h-1.5 bg-gradient-to-r from-[#F2935A] to-[#E07338]" />
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F5D9C0]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F2935A] to-[#E07338] flex items-center justify-center shadow-sm">
              <UserCog className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#3A2E26]">修改资料</h3>
              <p className="text-xs text-[#8A6F58]">更新您的个人信息</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#FDF1E2] transition-colors cursor-pointer">
            <X className="w-4 h-4 text-[#8A6F58]" />
          </button>
        </div>

        {/* 表单 */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8A6F58] mb-1.5">用户名</label>
            <input
              type="text"
              value={nickname}
              readOnly
              disabled
              className="w-full px-4 py-2.5 border border-[#F5D9C0] rounded-xl text-sm bg-[#FFF7EE] text-[#8A6F58] cursor-not-allowed"
              placeholder="用户名"
            />
            <p className="text-xs text-[#B5A89C] mt-1">用户名注册后无法修改</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8A6F58] mb-1.5">昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={100}
              className="w-full px-4 py-2.5 border border-[#F5D9C0] rounded-xl text-sm bg-white text-[#3A2E26] focus:outline-none focus:ring-2 focus:ring-[#F2935A]/40 focus:border-[#F2935A] transition-colors"
              placeholder="请输入昵称"
            />
          </div>
          {msg && (
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border ${
              msg.type === 'ok' ? 'bg-[#E2F0E6] border-[#7EB88E] text-[#5A8F6A]' : 'bg-[#FBDDD3] border-[#D9533A] text-[#D9533A]'
            }`}>
              {msg.type === 'ok' ? <Check className="w-4 h-4 flex-shrink-0" /> : <div className="w-1.5 h-1.5 rounded-full bg-[#D9533A] flex-shrink-0" />}
              {msg.text}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex gap-3 px-6 py-4 border-t border-[#F5D9C0] bg-[#FFF7EE]">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5A4B42] rounded-xl transition-colors text-sm font-medium border border-[#EADDD5] cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-[#F2935A] to-[#E07338] hover:opacity-90 text-white rounded-xl transition-all text-sm font-medium shadow-sm disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />保存中...</> : <><Check className="w-4 h-4" />保存修改</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** 修改密码弹窗 */
function ChangePwdModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ old: '', newPwd: '', confirm: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm({ old: '', newPwd: '', confirm: '' });
      setMsg(null);
    }
  }, [isOpen]);

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [field]: e.target.value }));
  };

  const handleSubmit = async () => {
    if (!form.old || !form.newPwd || !form.confirm) {
      setMsg({ type: 'err', text: '请填写所有字段' });
      return;
    }
    if (form.newPwd !== form.confirm) {
      setMsg({ type: 'err', text: '两次输入的新密码不一致' });
      return;
    }
    if (form.newPwd.length < 6) {
      setMsg({ type: 'err', text: '新密码至少 6 个字符' });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      await changePassword(form.old, form.newPwd);
      setMsg({ type: 'ok', text: '密码修改成功' });
      setTimeout(() => {
        localStorage.removeItem('vis4srd-auth');
        window.location.href = '/login';
      }, 1500);
    } catch (err: unknown) {
      const e = err instanceof Error ? err.message : '修改失败';
      setMsg({ type: 'err', text: e });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const inputType = showPwd ? 'text' : 'password';
  const pwdOk = form.newPwd.length >= 6;
  const pwdMatch = form.confirm.length > 0 && form.newPwd === form.confirm;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 animate-scale-in overflow-hidden border border-[#F5D9C0] pointer-events-auto">
        <div className="h-1.5 bg-gradient-to-r from-[#F2935A] to-[#E07338]" />
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F5D9C0]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#F2935A] to-[#E07338] flex items-center justify-center shadow-sm">
              <KeyRound className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#3A2E26]">修改密码</h3>
              <p className="text-xs text-[#8A6F58]">保护您的账户安全</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#FDF1E2] transition-colors cursor-pointer">
            <X className="w-4 h-4 text-[#8A6F58]" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#8A6F58] mb-1.5">原密码</label>
            <div className="relative">
              <input
                type={inputType}
                value={form.old}
                onChange={update('old')}
                placeholder="请输入当前密码"
                className="w-full px-4 py-2.5 pr-10 border border-[#F5D9C0] rounded-xl text-sm bg-white text-[#3A2E26] focus:outline-none focus:ring-2 focus:ring-[#F2935A]/40 focus:border-[#F2935A] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#B5A89C] hover:text-[#8A6F58] transition-colors cursor-pointer"
              >
                {showPwd ? <X className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8A6F58] mb-1.5">新密码</label>
            <input
              type={inputType}
              value={form.newPwd}
              onChange={update('newPwd')}
              placeholder="至少 6 个字符"
              className="w-full px-4 py-2.5 border border-[#F5D9C0] rounded-xl text-sm bg-white text-[#3A2E26] focus:outline-none focus:ring-2 focus:ring-[#F2935A]/40 focus:border-[#F2935A] transition-colors"
            />
            <div className="flex items-center gap-3 mt-1.5">
              <div className={`flex items-center gap-1 text-xs ${pwdOk ? 'text-[#7EB88E]' : 'text-[#B5A89C]'}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${pwdOk ? 'bg-[#7EB88E]' : 'bg-[#D4C4B0]'}`} />
                6+ 字符
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#8A6F58] mb-1.5">确认新密码</label>
            <div className="relative">
              <input
                type={inputType}
                value={form.confirm}
                onChange={update('confirm')}
                placeholder="再次输入新密码"
                className="w-full px-4 py-2.5 pr-10 border border-[#F5D9C0] rounded-xl text-sm bg-white text-[#3A2E26] focus:outline-none focus:ring-2 focus:ring-[#F2935A]/40 focus:border-[#F2935A] transition-colors"
              />
              {pwdMatch && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Check className="w-4 h-4 text-[#7EB88E]" />
                </div>
              )}
            </div>
          </div>
          {msg && (
            <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border ${
              msg.type === 'ok' ? 'bg-[#E2F0E6] border-[#7EB88E] text-[#5A8F6A]' : 'bg-[#FBDDD3] border-[#D9533A] text-[#D9533A]'
            }`}>
              {msg.type === 'ok' ? <Check className="w-4 h-4 flex-shrink-0" /> : <div className="w-1.5 h-1.5 rounded-full bg-[#D9533A] flex-shrink-0" />}
              {msg.text}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-[#F5D9C0] bg-[#FFF7EE]">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 bg-[#F4EBE1] hover:bg-[#EADDD5] text-[#5A4B42] rounded-xl transition-colors text-sm font-medium border border-[#EADDD5] cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="flex-[2] px-4 py-2.5 bg-gradient-to-r from-[#F2935A] to-[#E07338] hover:opacity-90 text-white rounded-xl transition-all text-sm font-medium shadow-sm disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />修改中...</> : <><Check className="w-4 h-4" />确认修改</>}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** 用户下拉菜单 */
function UserMenu({
  user,
  onClose,
  anchorRef,
  onOpenProfile,
  onOpenChangePwd,
  onCloseModals,
}: {
  user: AuthUser;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement>;
  onOpenProfile: () => void;
  onOpenChangePwd: () => void;
  onCloseModals: () => void;
}) {
  const navigate = useNavigate();
  const { logout: clearAuth } = useAuthStore();
  const menuRef = useRef<HTMLDivElement>(null);

  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setStyle({
        position: 'fixed' as const,
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      });
    }
  }, [anchorRef]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  const handleLogout = async () => {
    try { await logout(); } catch { /* ignore */ }
    clearAuth();
    navigate('/login', { replace: true });
  };

  const menuContent = (
    <div
      ref={menuRef}
      style={{ ...style, border: '1px solid #F5D9C0', paddingTop: '4px', paddingBottom: '4px' }}
      className="fixed w-48 bg-white rounded-xl shadow-xl z-50"
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid #F5D9C0' }}>
        <p className="text-sm font-semibold truncate" style={{ color: '#3A2E26' }}>{user.nickname}</p>
        <p className="text-xs mt-0.5 truncate" style={{ color: '#B5A89C' }}>@{user.username}</p>
      </div>
      <button
        onClick={() => { onClose(); onCloseModals(); onOpenProfile(); }}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm cursor-pointer transition-colors"
        style={{ color: '#5C4D43' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF7EE'; e.currentTarget.style.color = '#3A2E26'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#5C4D43'; }}
      >
        <UserCog className="w-4 h-4" />
        修改资料
      </button>
      <button
        onClick={() => { onClose(); onCloseModals(); onOpenChangePwd(); }}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm cursor-pointer transition-colors"
        style={{ color: '#5C4D43' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF7EE'; e.currentTarget.style.color = '#3A2E26'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#5C4D43'; }}
      >
        <KeyRound className="w-4 h-4" />
        修改密码
      </button>
      <button
        onClick={handleLogout}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm cursor-pointer transition-colors"
        style={{ color: '#D9533A' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#FFF7EE'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <LogOut className="w-4 h-4" />
        退出登录
      </button>
    </div>
  );

  return createPortal(menuContent, document.body);
}

export default function TopBar({ isCollapsed, setIsCollapsed }: TopBarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isAuthenticated } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showChangePwd, setShowChangePwd] = useState(false);
  const avatarBtnRef = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => setMenuOpen(false), []);
  const handleCloseModals = useCallback(() => {
    setShowProfile(false);
    setShowChangePwd(false);
  }, []);

  const isHomePage = location.pathname === '/' || location.pathname === '/home';
  const currentModule =
    NAV_ITEMS.find((item) =>
      item.id === 'home' ? isHomePage : location.pathname.startsWith(item.path)
    ) || NAV_ITEMS[0];

  const currentSubPages = SUB_PAGES[currentModule.id] || [];
  let currentSubPage = currentSubPages.find(
    (sub) =>
      location.pathname === sub.path || location.pathname.startsWith(sub.path + '/')
  ) || { path: currentModule.path, label: currentModule.label };

  if (location.pathname === '/chat') {
    currentSubPage = { path: '/chat', label: '心灵守护助手' };
  }

  const handleModuleClick = () => {
    navigate(currentModule.path);
  };

  const headerContent = (
    <>
      <header className="flex items-center justify-between px-6 py-3 sticky top-0 z-20" style={{
        background: 'rgba(255,251,247,.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(245,217,192,.6)'
      }}>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-2 rounded-lg transition-colors cursor-pointer"
            style={{ color: '#8A6F58' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(242,147,90,.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
          >
            <Menu className="w-5 h-5" />
          </button>
          {isHomePage ? (
            <span className="font-medium" style={{ color: '#E07338' }}>首页</span>
          ) : (
            <div className="flex items-center text-sm">
              <div
                onClick={handleModuleClick}
                className="flex items-center cursor-pointer transition-colors"
                style={{ color: '#8A6F58' }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#E07338'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#8A6F58'}
              >
                <span>{currentModule.label}</span>
              </div>
              {currentSubPage.label !== currentModule.label && (
                <>
                  <ChevronRight className="w-4 h-4 mx-2" style={{ color: '#B5A89C' }} />
                  <span className="font-medium" style={{ color: '#E07338' }}>{currentSubPage.label}</span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-6">
          {isAuthenticated && user ? (
            <div className="relative">
              <button
                ref={avatarBtnRef}
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 pl-4 cursor-pointer transition-opacity"
                style={{ borderLeft: '1px solid #F5D9C0' }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
                onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              >
                <UserAvatar user={user} />
                <div className="flex flex-col">
                  <span className="text-sm font-bold" style={{ color: '#3A2E26' }}>{user.nickname}</span>
                </div>
              </button>
              {menuOpen && (
                <UserMenu
                  user={user}
                  onClose={handleClose}
                  anchorRef={avatarBtnRef}
                  onOpenProfile={() => { setShowProfile(true); setShowChangePwd(false); }}
                  onOpenChangePwd={() => { setShowChangePwd(true); setShowProfile(false); }}
                  onCloseModals={handleCloseModals}
                />
              )}
            </div>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="text-sm font-medium hover:underline cursor-pointer"
              style={{ color: '#E07338' }}
            >
              登录
            </button>
          )}
        </div>
      </header>

      {/* 弹窗 */}
      <ProfileModal isOpen={showProfile} onClose={() => setShowProfile(false)} />
      <ChangePwdModal isOpen={showChangePwd} onClose={() => setShowChangePwd(false)} />
    </>
  );

  return headerContent;
}
