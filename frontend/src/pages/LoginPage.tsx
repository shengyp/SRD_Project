/**
 * 登录页 — 居中卡片设计，无左侧介绍区域
 * 与系统整体暖橙色风格保持一致
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeOff, Heart, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import { login } from '../api';
import { useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login: setAuth } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('请输入用户名和密码');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await login(username.trim(), password);
      setAuth(res.user, res.token);
      navigate('/home', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败，请检查用户名和密码';
      setError(msg.replace(/API 请求失败: \d+ /, ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #FFF5EE 0%, #FFEDD8 40%, #FFE4CC 100%)' }}>
      {/* 背景装饰圆形 */}
      <div className="absolute top-20 left-16 w-72 h-72 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #C19A83 0%, transparent 70%)' }} />
      <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #B8896F 0%, transparent 70%)' }} />
      <div className="absolute top-1/3 right-1/4 w-40 h-40 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #A07D6B 0%, transparent 70%)' }} />

      {/* 小装饰点 */}
      <div className="absolute top-[18%] left-[15%] w-2 h-2 rounded-full opacity-40" style={{ backgroundColor: '#C19A83' }} />
      <div className="absolute top-[30%] right-[12%] w-3 h-3 rounded-full opacity-25" style={{ backgroundColor: '#B8896F' }} />
      <div className="absolute bottom-[25%] left-[22%] w-2 h-2 rounded-full opacity-30" style={{ backgroundColor: '#A07D6B' }} />
      <div className="absolute top-[60%] left-[8%] w-1.5 h-1.5 rounded-full opacity-35" style={{ backgroundColor: '#C19A83' }} />
      <div className="absolute bottom-[15%] right-[28%] w-2 h-2 rounded-full opacity-20" style={{ backgroundColor: '#B8896F' }} />

      {/* 主卡片 */}
      <div className="relative w-full max-w-md mx-4 animate-fade-in">
        {/* Logo 区 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #C19A83 0%, #A07D6B 100%)' }}>
            <Heart className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">心轨心理平台</h1>
          <p className="text-gray-500 text-sm mt-1">Visual Suicide Risk Detection</p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl shadow-[#C19A83]/10 border border-white/60 overflow-hidden">
          {/* 卡片顶部渐变条 */}
          <div className="h-1.5" style={{ background: 'linear-gradient(90deg, #C19A83, #B8896F, #A07D6B)' }} />

          <div className="px-8 py-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-800">欢迎回来</h2>
              <p className="text-gray-500 text-sm mt-1">请登录您的账户以继续使用</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              {/* 用户名 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">用户名</label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#C19A83]">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="请输入用户名"
                    autoComplete="username"
                    className="w-full pl-10 pr-4 py-3 bg-gray-50/80 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C19A83]/30 focus:border-[#C19A83] transition-all placeholder-gray-400"
                  />
                </div>
              </div>

              {/* 密码 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">密码</label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#C19A83]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-3 bg-gray-50/80 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C19A83]/30 focus:border-[#C19A83] transition-all placeholder-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-500 text-sm rounded-xl px-4 py-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* 登录按钮 */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-medium text-sm text-white shadow-lg shadow-[#C19A83]/25 hover:shadow-xl hover:shadow-[#C19A83]/30 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
                style={{ background: 'linear-gradient(135deg, #C19A83 0%, #A07D6B 100%)' }}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    登录中...
                  </>
                ) : (
                  <>
                    登录
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">还没有账户？</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* 注册入口 */}
            <button
              onClick={() => navigate('/register')}
              className="w-full py-2.5 border border-[#C19A83]/30 text-[#A07D6B] rounded-xl font-medium text-sm hover:bg-[#C19A83]/5 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              <Sparkles className="w-3.5 h-3.5" />
              立即注册
            </button>
          </div>
        </div>

        {/* 底部版权 */}
        <p className="text-center text-xs text-gray-400 mt-6">心轨心理平台 · 保护您的隐私安全</p>
      </div>
    </div>
  );
}
