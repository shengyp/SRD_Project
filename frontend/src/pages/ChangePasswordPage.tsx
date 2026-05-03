/**
 * 修改密码页 — 白灰蓝科研风，与登录/注册页面风格统一
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Eye, EyeOff, Check, ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import { changePassword } from '../api';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ old: '', newPwd: '', confirmPwd: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.old || !form.newPwd || !form.confirmPwd) {
      setMsg({ type: 'err', text: '请填写所有字段' });
      return;
    }
    if (form.newPwd !== form.confirmPwd) {
      setMsg({ type: 'err', text: '两次输入的新密码不一致' });
      return;
    }
    if (form.newPwd.length < 6) {
      setMsg({ type: 'err', text: '新密码至少需要 6 个字符' });
      return;
    }
    setLoading(true);
    setMsg(null);
    try {
      await changePassword(form.old, form.newPwd);
      setMsg({ type: 'ok', text: '密码修改成功，请重新登录' });
      setTimeout(() => {
        localStorage.removeItem('vis4srd-auth');
        navigate('/login', { replace: true });
      }, 1500);
    } catch (err: unknown) {
      const e = err instanceof Error ? err.message : '修改失败';
      setMsg({ type: 'err', text: e });
    } finally {
      setLoading(false);
    }
  };

  const inputType = showPwd ? 'text' : 'password';
  const pwdOk = form.newPwd.length >= 6;
  const pwdMatch = form.confirmPwd.length > 0 && form.newPwd === form.confirmPwd;

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #F8FBFF 0%, #F2F6FB 45%, #EAF0F8 100%)' }}>
      {/* 背景装饰圆形 */}
      <div className="absolute top-20 left-16 w-72 h-72 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #8CB5F2 0%, transparent 70%)' }} />
      <div className="absolute bottom-20 right-20 w-96 h-96 rounded-full opacity-15" style={{ background: 'radial-gradient(circle, #6F8FC9 0%, transparent 70%)' }} />
      <div className="absolute top-1/3 right-1/4 w-40 h-40 rounded-full opacity-10" style={{ background: 'radial-gradient(circle, #94A3B8 0%, transparent 70%)' }} />

      {/* 小装饰点 */}
      <div className="absolute top-[18%] left-[15%] w-2 h-2 rounded-full opacity-40" style={{ backgroundColor: '#7EA8FF' }} />
      <div className="absolute top-[30%] right-[12%] w-3 h-3 rounded-full opacity-25" style={{ backgroundColor: '#A8BEDF' }} />
      <div className="absolute bottom-[25%] left-[22%] w-2 h-2 rounded-full opacity-30" style={{ backgroundColor: '#94A3B8' }} />
      <div className="absolute top-[60%] left-[8%] w-1.5 h-1.5 rounded-full opacity-35" style={{ backgroundColor: '#7EA8FF' }} />
      <div className="absolute bottom-[15%] right-[28%] w-2 h-2 rounded-full opacity-20" style={{ backgroundColor: '#A8BEDF' }} />

      {/* 主卡片 */}
      <div className="relative w-full max-w-md mx-4 animate-fade-in">
        {/* Logo 区 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-lg" style={{ background: 'linear-gradient(135deg, #89ACFF 0%, #2F6BFF 55%, #1D4ED8 100%)', boxShadow: '0 14px 28px rgba(47,107,255,.18)' }}>
            <ShieldCheck className="w-8 h-8 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-bold text-[#162033] tracking-tight">账户安全</h1>
          <p className="text-[#6B7A90] text-sm mt-1">定期更换密码，保护账户安全</p>
        </div>

        {/* 表单卡片 */}
        <div className="bg-white/86 backdrop-blur-xl rounded-3xl shadow-2xl shadow-[rgba(15,23,42,0.08)] border border-[#E2E8F0] overflow-hidden">
          {/* 卡片顶部渐变条 */}
          <div className="h-1.5" style={{ background: 'linear-gradient(90deg, #2F6BFF, #5B8CFF, #9EC0F4)' }} />

          <div className="px-8 py-8">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-gray-800">修改密码</h2>
              <p className="text-gray-500 text-sm mt-1">请填写以下信息以修改密码</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* 原密码 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">原密码</label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#2F6BFF]">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type={inputType}
                    value={form.old}
                    onChange={update('old')}
                    placeholder="请输入当前密码"
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2F6BFF]/25 focus:border-[#2F6BFF] transition-all placeholder-gray-400"
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

              {/* 新密码 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">新密码</label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#2F6BFF]">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type={inputType}
                    value={form.newPwd}
                    onChange={update('newPwd')}
                    placeholder="至少 6 个字符"
                    autoComplete="new-password"
                    className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2F6BFF]/25 focus:border-[#2F6BFF] transition-all placeholder-gray-400"
                  />
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <div className={`flex items-center gap-1 text-xs ${pwdOk ? 'text-green-500' : 'text-gray-400'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${pwdOk ? 'bg-green-500' : 'bg-gray-300'}`} />
                    6+ 字符
                  </div>
                  <div className={`flex items-center gap-1 text-xs ${pwdMatch ? 'text-green-500' : 'text-gray-400'}`}>
                    <div className={`w-1.5 h-1.5 rounded-full transition-colors ${pwdMatch ? 'bg-green-500' : 'bg-gray-300'}`} />
                    两次一致
                  </div>
                </div>
              </div>

              {/* 确认新密码 */}
              <div className="group">
                <label className="block text-sm font-medium text-gray-600 mb-2">确认新密码</label>
                <div className="relative">
                  <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-[#2F6BFF]">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type={inputType}
                    value={form.confirmPwd}
                    onChange={update('confirmPwd')}
                    placeholder="再次输入新密码"
                    autoComplete="new-password"
                    className="w-full pl-10 pr-4 py-3 bg-[#F7F9FC] border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#2F6BFF]/25 focus:border-[#2F6BFF] transition-all placeholder-gray-400"
                  />
                  {pwdMatch && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      <Check className="w-4 h-4 text-green-500" />
                    </div>
                  )}
                </div>
              </div>

              {/* 消息提示 */}
              {msg && (
                <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm border ${
                  msg.type === 'ok'
                    ? 'bg-green-50 border-green-200 text-green-600'
                    : 'bg-red-50 border-red-200 text-red-500'
                }`}>
                  {msg.type === 'ok' ? (
                    <Check className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  )}
                  {msg.text}
                </div>
              )}

              {/* 按钮行 */}
              <div className="flex gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-xl font-medium text-sm hover:bg-gray-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4" />
                  返回
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] py-3 rounded-xl font-medium text-sm text-white shadow-lg shadow-[#2F6BFF]/20 hover:shadow-xl hover:shadow-[#2F6BFF]/25 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  style={{ background: 'linear-gradient(135deg, #5B8CFF 0%, #2F6BFF 52%, #1D4ED8 100%)' }}
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      修改中...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      确认修改
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* 底部版权 */}
        <p className="text-center text-xs text-gray-400 mt-6">心轨心理平台 · 保护您的隐私安全</p>
      </div>
    </div>
  );
}
