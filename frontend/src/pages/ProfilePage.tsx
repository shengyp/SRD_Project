/**
 * 个人资料页 — 修改昵称
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Check, ArrowLeft, Loader } from 'lucide-react';
import { fetchMe, updateProfile } from '../api';
import { useAuthStore } from '../store/authStore';

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuthStore();
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    fetchMe()
      .then((u) => {
        setNickname(u.nickname || '');
      })
      .catch(() => {
        if (user) setNickname(user.nickname);
      })
      .finally(() => setFetching(false));
  }, []);

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
      setTimeout(() => navigate(-1), 1200);
    } catch (err: unknown) {
      const e = err instanceof Error ? err.message : '保存失败';
      setMsg({ type: 'err', text: e });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto py-8 px-4">
      {/* 返回按钮 */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-[#64748B] hover:text-[#162033] mb-6 text-sm transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>

      <div className="bg-white rounded-[28px] shadow-[0_10px_28px_rgba(15,23,42,0.04)] border border-[#E2E8F0] overflow-hidden">
        {/* 卡片头 */}
        <div className="bg-gradient-to-r from-[#2F6BFF] to-[#5B8CFF] px-6 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/20 flex items-center justify-center backdrop-blur-sm border border-white/30">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">个人资料</h2>
            <p className="text-white/75 text-sm mt-0.5">维护论文演示系统中的个人展示信息</p>
          </div>
        </div>

        <div className="px-6 py-6 space-y-5">
          {/* 用户名（只读） */}
          <div>
            <label className="block text-sm font-medium text-[#415168] mb-1.5">用户名</label>
            <input
              type="text"
              value={user?.username ?? ''}
              readOnly
              disabled
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 text-gray-400 cursor-not-allowed"
            />
            <p className="text-xs text-[#94A3B8] mt-1">用户名注册后无法修改</p>
          </div>

          {/* 昵称 */}
          <div>
            <label className="block text-sm font-medium text-[#415168] mb-1.5">昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="请输入昵称"
              maxLength={100}
              className="w-full px-4 py-2.5 border border-[#E2E8F0] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-[#2F6BFF] transition-colors bg-white"
            />
          </div>

          {/* 消息提示 */}
          {msg && (
            <div
              className={`px-4 py-2.5 rounded-xl text-sm border ${
                msg.type === 'ok'
                  ? 'bg-green-50 border-green-200 text-green-600'
                  : 'bg-red-50 border-red-200 text-red-600'
              }`}
            >
              {msg.text}
            </div>
          )}

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={loading || fetching}
            className="w-full py-2.5 bg-gradient-to-r from-[#2F6BFF] to-[#5B8CFF] text-white rounded-xl font-medium text-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                保存中...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                保存修改
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
