import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, AlertTriangle, Heart, Shield, RefreshCw, MessageSquare, Brain, Activity, Loader, Sun, TrendingDown, Printer
} from 'lucide-react';
import {
  fetchScaleTaskResult,
  createScaleTask,
  type ScaleTask,
} from '../api';
import { formatDateTime } from '../utils/dateFormat';
import {
  getScaleByCode,
  getScaleMeta,
  getThresholdByScore,
  getRiskColors,
  loadScalesData,
  type ScaleDefinition,
} from '../scales';
import ActionCapsuleButton from '../components/ActionCapsuleButton';

interface RiskInfo {
  level: string;
  label: string;
  suggestion?: string;
}

export default function ScaleResultPage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();

  const [task, setTask] = useState<ScaleTask | null>(null);
  const [scale, setScale] = useState<ScaleDefinition | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retesting, setRetesting] = useState(false);

  // 加载任务数据（从后端 API）+ 量表信息（从本地）
  useEffect(() => {
    if (!taskId) {
      navigate('/scale');
      return;
    }

    const loadTaskAndScale = async () => {
      setPageLoading(true);
      setLoadError(null);
      try {
        // 初始化量表数据（如果尚未加载）
        await loadScalesData();

        const taskData = await fetchScaleTaskResult(Number(taskId));
        setTask(taskData);

        const scaleCode = taskData.scaleCode;
        if (!scaleCode) {
          setLoadError('任务缺少量表代码');
          return;
        }

        const scaleData = getScaleByCode(scaleCode);
        if (!scaleData) {
          setLoadError(`未找到量表: ${scaleCode}`);
          return;
        }
        setScale(scaleData);
      } catch (err) {
        console.error('加载任务结果失败:', err);
        setLoadError('加载任务结果失败，请检查网络连接');
      } finally {
        setPageLoading(false);
      }
    };

    loadTaskAndScale();
  }, [taskId, navigate]);

  // 获取风险信息：后端已计算好 risk_level，前端仅查表获取 label 和 suggestion
  const getRiskInfo = (): RiskInfo | null => {
    if (!task?.riskLevel || !scale) return null;

    if (task.assessmentResult && typeof task.assessmentResult === 'object') {
      return {
        level: task.riskLevel,
        label: task.assessmentResult.label || task.riskLevel,
        suggestion: task.assessmentResult.suggestion,
      };
    }

    const thresholdInfo = getThresholdByScore(scale.code, task.totalScore || 0);
    return {
      level: task.riskLevel,
      label: thresholdInfo?.label || task.riskLevel,
      suggestion: thresholdInfo?.suggestion,
    };
  };

  // 获取缓解话语
  const getComfortMessage = () => {
    if (!task) return null;
    const isHighRisk = task.riskLevel === 'high' || task.riskLevel === 'medium';

    if (isHighRisk) {
      return {
        title: '建议进一步评估',
        content: '您的得分达到或超过筛查阈值，建议进行进一步专业评估与检测。本系统可帮助您联系专业心理医生获取更全面的支持。',
        suggestions: [
          '建议进入「风险检测」模块进行更全面的分析',
          '如有紧急情况，请拨打心理援助热线',
          '量表结果仅供参考，不作为诊断依据',
        ],
        action: '进入风险检测',
      };
    }

    return {
      title: '处于安全范围',
      content: '您当前的评估结果显示处于安全范围内。请继续保持关注心理健康，如有需要仍可随时使用本系统或咨询专业人士。',
      suggestions: [
        '继续保持良好的生活习惯',
        '定期关注心理健康',
        '如有需要可随时使用本系统',
      ],
      action: null,
    };
  };

  // 获取量表展示信息
  const getScaleDisplayInfo = () => {
    const code = scale?.code || task?.scaleCode || '';
    const meta = getScaleMeta(code);
    if (!meta) return { icon: 'Brain', name: code, color: 'bg-purple-100 text-purple-700', bgColor: 'bg-purple-500' };
    return { icon: meta.category, name: meta.name, color: meta.color, bgColor: meta.bgColor };
  };

  const ScaleIcon = ({ type }: { type: string }) => {
    switch (type) {
      case 'Brain': return <Brain className="w-8 h-8 text-white" />;
      case 'Shield': return <Shield className="w-8 h-8 text-white" />;
      case 'Activity': return <Activity className="w-8 h-8 text-white" />;
      case 'Heart': return <Heart className="w-8 h-8 text-white" />;
      case 'Sun': return <Sun className="w-8 h-8 text-white" />;
      case 'TrendingDown': return <TrendingDown className="w-8 h-8 text-white" />;
      default: return <Brain className="w-8 h-8 text-white" />;
    }
  };

  const handleBack = () => {
    navigate('/scale');
  };

  const handleRetest = async () => {
    if (!task) return;

    setRetesting(true);
    try {
      const newTask = await createScaleTask({
        userHash: task.userHash,
        archiveId: task.archiveId,
        scaleId: task.scaleCode,
        dataSource: task.dataSource,
      });

      navigate(`/scale/answer/${newTask.id}`);
    } catch (err) {
      console.error('创建复测任务失败:', err);
      setRetesting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  if (pageLoading || !task || !scale) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 text-[#2F6BFF] mx-auto mb-4 animate-spin" />
          <p className="text-[#64748B]">加载中...</p>
          {loadError && (
            <p className="text-red-500 text-sm mt-2">{loadError}</p>
          )}
        </div>
      </div>
    );
  }

  const isHighRisk = task.riskLevel === 'high' || task.riskLevel === 'medium';
  const riskInfo = getRiskInfo();
  const comfortMessage = getComfortMessage();
  const riskColors = getRiskColors(task.riskLevel || 'low');
  const scaleDisplay = getScaleDisplayInfo();
  const scaleMeta = getScaleMeta(scale?.code || '');
  const scaleMaxScore = scale?.scoring?.max_standard_score ?? scale?.scoring?.max_score ?? 27;
  const assessmentPayload = task.assessmentResult && typeof task.assessmentResult === 'object'
    ? task.assessmentResult
    : null;

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full animate-fade-in space-y-5">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-3">
          <span className={`px-4 py-1.5 ${scaleDisplay.color} rounded-full text-sm font-medium`}>{scaleDisplay.name}</span>
          <span className="text-sm text-[#64748B]">评估结果</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleRetest}
            disabled={retesting}
            className="flex items-center gap-2 px-4 py-2 border border-[#E2E8F0] rounded-xl text-[#415168] hover:bg-[#F1F5FA] transition-colors disabled:opacity-50"
          >
            {retesting ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            重新测评
          </button>
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 border border-[#E2E8F0] rounded-xl text-[#415168] hover:bg-[#F1F5FA] transition-colors"
          >
            <Printer className="w-4 h-4" />
            打印报告
          </button>
        </div>
      </div>

      {/* 结果卡片 */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-sm scale-result-card">
        {/* 任务信息 */}
        <div className="bg-[#F7FAFD] rounded-xl border border-[#DCE7F5] p-4 flex items-center gap-4 mb-6">
          <div className={`w-12 h-12 rounded-xl ${scaleDisplay.bgColor} flex items-center justify-center`}>
            <ScaleIcon type={scaleDisplay.icon} />
          </div>
          <div>
            <p className="font-bold text-[#162033]">{task.taskName}</p>
            <p className="text-sm text-[#64748B]">
              评估用户：{task.userAlias || task.userHash || '用户'} · 完成时间：{formatDateTime(task.completedAt)}
            </p>
          </div>
        </div>

        {/* 得分与阈值 */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          {/* 当前得分 */}
          <div className="bg-[#F7FAFD] rounded-2xl p-6 text-center">
            <p className="text-sm text-[#64748B] mb-2">当前得分</p>
            <div className="text-5xl font-bold text-[#162033] mb-1">{task.totalScore || 0}</div>
            <p className="text-sm text-[#94A3B8]">/{scaleMaxScore} 分</p>
          </div>

          {/* 风险阈值 */}
          <div className="bg-[#F7FAFD] rounded-2xl p-6 text-center">
            <p className="text-sm text-[#64748B] mb-2">风险阈值</p>
            <div className="text-5xl font-bold text-[#162033] mb-1">≥ {scaleMeta?.threshold || 10}</div>
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
              isHighRisk ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
            }`}>
              {isHighRisk ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  超过阈值
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  安全范围
                </>
              )}
            </div>
          </div>
        </div>

        {/* 风险等级 */}
        {riskInfo && (
          <div className={`${riskColors.bg} rounded-2xl p-6 text-center mb-6`}>
            <p className="text-white text-lg font-bold mb-1">{scaleDisplay.name} 评估结果</p>
            <p className="text-white text-2xl font-bold">{riskInfo.label}</p>
            <p className="text-white/80 text-sm mt-2">{riskInfo.suggestion || assessmentPayload?.summary || ''}</p>
          </div>
        )}

        {assessmentPayload?.dimensions?.length ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {assessmentPayload.dimensions.map((dimension: any) => (
              <div key={dimension.id} className="rounded-2xl border border-[#E2E8F0] bg-[#F7FAFD] p-4">
                <p className="text-sm text-[#64748B] mb-2">{dimension.name}</p>
                <p className="text-2xl font-bold text-[#162033]">{dimension.score} 分</p>
                <p className="text-sm text-[#5B78C7] mt-2">{dimension.label}</p>
              </div>
            ))}
          </div>
        ) : null}

        {assessmentPayload?.alerts?.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 mb-6">
            <h4 className="font-bold text-[#162033] mb-3 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              重点提示
            </h4>
            <div className="space-y-2 text-sm text-[#7A4B00]">
              {assessmentPayload.alerts.map((alert: any, index: number) => (
                <p key={`${alert.itemId}-${index}`}>{alert.message}</p>
              ))}
            </div>
          </div>
        ) : null}

        {/* 信息暗示 */}
        {comfortMessage && (
          <>
            <div className={`${riskColors.bgLight} rounded-2xl p-5 mb-4`}>
              <h4 className="font-bold text-[#162033] mb-3 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#2F6BFF]" />
                信息暗示
              </h4>
              <p className="text-[#415168] leading-relaxed mb-3">{comfortMessage.content}</p>
              <ul className="space-y-2">
                {comfortMessage.suggestions.map((suggestion, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm text-[#415168]">
                    <Check className="w-4 h-4 text-[#2F6BFF] mt-0.5 shrink-0" />
                    {suggestion}
                  </li>
                ))}
              </ul>
            </div>

            {/* 缓解话语 */}
            <div className="bg-white border border-[#DCE7F5] rounded-2xl p-5 mb-6">
              <h4 className="font-bold text-[#162033] mb-3 flex items-center gap-2">
                <Heart className="w-5 h-5 text-pink-400" />
                {comfortMessage.title}
              </h4>
              <p className="text-[#415168] leading-relaxed">{comfortMessage.content}</p>
            </div>
          </>
        )}

        {/* 操作按钮 */}
        <div className="flex items-center justify-center gap-4 print-hide">
          <ActionCapsuleButton onClick={handleBack} variant="neutral" size="lg" icon={<ArrowLeft className="w-5 h-5" />}>
            返回任务列表
          </ActionCapsuleButton>
        </div>
      </div>
    </div>
  );
}
