/**
 * 注册页 — 居中卡片设计，无左侧介绍区域
 * 与系统整体暖橙色风格保持一致
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, Eye, EyeOff, Heart, ArrowRight, Loader2, Check } from 'lucide-react';
import { register } from '../api';
import { useAuthStore } from '../store/authStore';

export default function RegisterPage() {
  const navigate = useNavigate();
  const { login: setAuth } = useAuthStore();

  const [form, setForm] = useState({ username: '', password: '', confirmPwd: '', nickname: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const { username, password, confirmPwd, nickname } = form;
    if (!username.trim() || !password || !confirmPwd) {
      setError('请填写所有必填项');
      return;
    }
    if (password !== confirmPwd) {
      setError('两次输入的密码不一致');
      return;
    }
    if (password.length < 6) {
      setError('密码至少需要 6 个字符');
      return;
    }
    if (username.trim().length < 3) {
      setError('用户名至少需要 3 个字符');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await register(username.trim(), password, nickname.trim() || undefined);
      setAuth(res.user, res.token);
      navigate('/home', { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '注册失败';
      setError(msg.replace(/API 请求失败: \d+ /, ''));
    } finally {
      setLoading(false);
    }
  };

  const pwdOk = form.password.length >= 6;
  const pwdMatch = form.confirmPwd.length > 0 && form.password === form.confirmPwd;
  const usernameOk = form.username.trim().length >= 3;

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #FFF5EE 0%, #FFEDD8 40%, #FFE4CC 100%)' }}>
      {/* 背景装饰圆形 */}
      <div className="absolute top-20 right-20 w-72 h-72 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #C19A83 0%, transparent 70%)' }} />
      <div className="absolute bottom-20 left-16 w-96 h-96 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #B8896F 0%, transparent 70%)' }} />
      <div className="absolute top-1/3 left-1/4 w-40 h-40 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #A07D6B 0%, transparent 70%)' }} />

      {/* 小装饰点 */}
      <div className="absolute top-[15%] right-[18%] w-2 h-2 rounded-full opacity-40" style={{ backgroundColor: '#C19A83' }} />
      <div className="absolute top-[28%] left-[10%] w-3 h-3 rounded-full opacity-25" style={{ backgroundColor: '#B8896F' }} />
      <div className="absolute bottom-[22%] right-[25%] w-2 h-2 rounded-full opacity-30" style={{ backgroundColor: '#A07D6B' }} />
      <div className="absolute top-[65%] right-[8%] w-1.5 h-1.5 rounded-full opacity-35" style={{ backgroundColor: '#C19A83' }} />
      <div className="absolute bottom-[12%] left-[30%] w-2 h-2 rounded-full opacity-20" style={{ backgroundColor: '#B8896F' }} />

      {/* 主卡片 */}
      <div className="relative w-full max-w-md mx-4 animate-fade-in">
        {/* Logo 区 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #C19A83 0%, #A07D6B 100%)' }}>
            <Heart className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">心轨心理平台</h1>
          <p className="text-gray-500 text-sm mt-1">创建您的专属账户</p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl shadow-[#C19A83]/10 border border-white/60 overflow-hidden">
          {/* 卡片顶部渐变条 */}
          <div className="h-1.5" style={{ background: 'linear-gradient(90deg, #C19A83, #B8896F, #A07D6B)' }} />

          <div className="px-8 py-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-800">创建账户</h2>
              <p className="text-gray-500 text-sm mt-1">注册即表示您同意我们的服务条款</p>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              {/* 用户名 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  用户名 <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#C19A83]">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={form.username}
                    onChange={update('username')}
                    placeholder="3-50位字母、数字、下划线或中文"
                    autoComplete="username"
                    className="w-full pl-10 pr-4 py-3 bg-gray-50/80 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C19A83]/30 focus:border-[#C19A83] transition-all placeholder-gray-400"
                  />
                  {usernameOk && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      <Check className="w-4 h-4 text-green-500" />
                    </div>
                  )}
                </div>
              </div>

              {/* 昵称（可选） */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  昵称 <span className="text-gray-400 font-normal">(可选)</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#C19A83]">
                    <User className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={form.nickname}
                    onChange={update('nickname')}
                    placeholder="公开显示的昵称，不填则显示用户名"
                    className="w-full pl-10 pr-4 py-3 bg-gray-50/80 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C19A83]/30 focus:border-[#C19A83] transition-all placeholder-gray-400"
                  />
                </div>
              </div>

              {/* 密码 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  密码 <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#C19A83]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={form.password}
                    onChange={update('password')}
                    placeholder="至少 6 个字符"
                    autoComplete="new-password"
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
                {/* 密码强度提示 */}
                <div className="flex items-center gap-2 mt-2">
                  <div className={`flex items-center gap-1 text-xs ${pwdOk ? 'text-green-500' : 'text-gray-400'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${pwdOk ? 'bg-green-500' : 'bg-gray-300'}`} />
                    6+ 字符
                  </div>
                </div>
              </div>

              {/* 确认密码 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  确认密码 <span className="text-red-400">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#C19A83]">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={form.confirmPwd}
                    onChange={update('confirmPwd')}
                    placeholder="再次输入密码"
                    autoComplete="new-password"
                    className="w-full pl-10 pr-10 py-3 bg-gray-50/80 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#C19A83]/30 focus:border-[#C19A83] transition-all placeholder-gray-400"
                  />
                  {pwdMatch && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      <Check className="w-4 h-4 text-green-500" />
                    </div>
                  )}
                </div>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-500 text-sm rounded-xl px-4 py-2.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* 注册按钮 */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-medium text-sm text-white shadow-lg shadow-[#C19A83]/25 hover:shadow-xl hover:shadow-[#C19A83]/30 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-1"
                style={{ background: 'linear-gradient(135deg, #C19A83 0%, #A07D6B 100%)' }}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    注册中...
                  </>
                ) : (
                  <>
                    注册
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            {/* 分隔线 */}
            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">已有账户？</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            {/* 登录入口 */}
            <button
              onClick={() => navigate('/login')}
              className="w-full py-2.5 border border-[#C19A83]/30 text-[#A07D6B] rounded-xl font-medium text-sm hover:bg-[#C19A83]/5 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              立即登录
            </button>
          </div>
        </div>

        {/* 底部版权 */}
        <p className="text-center text-xs text-gray-400 mt-6">心轨心理平台 · 保护您的隐私安全</p>
      </div>
    </div>
  );
}
