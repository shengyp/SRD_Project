import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, AlertTriangle, Heart, Shield, RefreshCw, MessageSquare, Brain, Activity, Loader, Sun, TrendingDown, Printer, MoonStar
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

interface WorkflowSignals {
  needsFollowUp?: boolean;
  needsCrisisIntervention?: boolean;
  sleepSignal?: boolean;
  profileOnly?: boolean;
}

interface AnswerSummaryItem {
  qId: number;
  questionText: string;
  answerLabel: string;
  score: number;
}

export default function ScaleResultPage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();

  const [task, setTask] = useState<ScaleTask | null>(null);
  const [scale, setScale] = useState<ScaleDefinition | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retesting, setRetesting] = useState(false);
  const reportRef = useRef<HTMLDivElement | null>(null);

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
    const workflowSignals: WorkflowSignals = task.assessmentResult?.workflowSignals || {};
    const isHighRisk = task.riskLevel === 'high' || task.riskLevel === 'medium';

    if (workflowSignals.needsCrisisIntervention) {
      return {
        title: '需立即危机干预',
        content: '当前结果出现高危自杀相关信号，应立即进入危机干预流程，并由专业人员进行人工复核与临床评估。',
        suggestions: [
          '立即通知专业心理/精神科人员介入',
          '启动危机干预与安全保护流程',
          '该结果不能仅靠系统自动化处理，需要人工接管',
        ],
        action: '立即危机干预',
      };
    }

    if (workflowSignals.profileOnly) {
      return {
        title: '用于情绪画像',
        content: '该量表更适合用于观察抑郁、焦虑、压力等多维状态变化，不单独作为危机判定依据。',
        suggestions: [
          '结合 PHQ-9、GAD-7、ISI 等核心筛查量表一起看',
          '优先关注各维度变化趋势，而不是单次结果',
          '若存在危机线索，仍需补做专项风险量表',
        ],
        action: null,
      };
    }

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
      case 'sleep': return <MoonStar className="w-8 h-8 text-white" />;
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
      window.alert(err instanceof Error ? err.message : '创建复测任务失败');
    } finally {
      setRetesting(false);
    }
  };

  const handlePrint = () => {
    const reportTitle = `${scaleDisplay.name}_评估报告_${task.userAlias || task.userHash || task.id}`;
    const reportHtml = reportRef.current?.outerHTML;
    if (!reportHtml) {
      window.alert('报告内容尚未准备好，请稍后重试');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1100,height=900');
    if (!printWindow) {
      const previousTitle = document.title;
      document.title = reportTitle;
      window.print();
      window.setTimeout(() => {
        document.title = previousTitle;
      }, 300);
      return;
    }

    const styleMarkup = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => node.outerHTML)
      .join('\n');

    printWindow.document.open();
    printWindow.document.write(`
      <!doctype html>
      <html lang="zh-CN">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${reportTitle}</title>
          ${styleMarkup}
          <style>
            body {
              margin: 0;
              padding: 24px;
              background: #ffffff;
            }

            .no-print,
            .print-hide {
              display: none !important;
            }

            .print-only {
              display: block !important;
            }

            .scale-result-card {
              width: 100% !important;
              max-width: none !important;
              margin: 0 !important;
              border: none !important;
              box-shadow: none !important;
              padding: 0 !important;
            }

            @page {
              size: A4;
              margin: 12mm;
            }

            @media print {
              body {
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          ${reportHtml}
          <script>
            window.addEventListener('load', () => {
              window.setTimeout(() => {
                window.focus();
                window.print();
              }, 150);
            });
          <\/script>
        </body>
      </html>
    `);
    printWindow.document.close();
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
  const workflowSignals: WorkflowSignals = assessmentPayload?.workflowSignals || {};
  const recommendedActions: string[] = assessmentPayload?.recommendedActions || [];
  const recommendedNextScales: string[] = assessmentPayload?.recommendedNextScales || [];
  const authority = assessmentPayload?.authority || (scaleMeta?.authority ? {
    sourceUrl: scaleMeta.authority.sourceUrl,
    originalPaper: scaleMeta.authority.originalPaper,
    licenseNote: scaleMeta.authority.licenseNote,
    validatedPopulation: scaleMeta.authority.validatedPopulation,
    screeningOnly: scaleMeta.authority.screeningOnly,
  } : null);
  const answerSummary: AnswerSummaryItem[] = (task.answers || []).map((item) => {
    const question = scale.questions.find((entry) => entry.id === item.qId);
    const option = question?.options.find((entry) => entry.value === item.score);
    return {
      qId: item.qId,
      questionText: question?.text || `第 ${item.qId} 题`,
      answerLabel: option?.label || '未匹配到选项',
      score: item.normalizedScore ?? item.score,
    };
  });

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
            打印 / 导出 PDF
          </button>
        </div>
      </div>

      {/* 结果卡片 */}
      <div ref={reportRef} className="bg-white rounded-2xl border border-[#E2E8F0] p-6 shadow-sm scale-result-card">
        <div className="print-only hidden border-b border-[#D9DEE8] pb-4 mb-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h1 className="text-2xl font-bold text-[#162033]">{scaleDisplay.name}评估报告</h1>
              <p className="text-sm text-[#64748B] mt-1">
                评估用户：{task.userAlias || task.userHash || '用户'} | 任务名称：{task.taskName}
              </p>
            </div>
            <div className="text-right text-sm text-[#64748B]">
              <p>任务编号：{task.id}</p>
              <p>完成时间：{formatDateTime(task.completedAt)}</p>
              <p>导出时间：{formatDateTime(new Date().toISOString())}</p>
            </div>
          </div>
        </div>

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

        {answerSummary.length ? (
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 mb-6 report-answer-section">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h4 className="font-bold text-[#162033]">答题明细</h4>
              <span className="text-xs text-[#64748B]">
                共 {answerSummary.length} 题，便于打印存档与人工复核
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full report-answer-table">
                <thead>
                  <tr>
                    <th className="w-16">题号</th>
                    <th>题目</th>
                    <th className="w-48">作答</th>
                    <th className="w-20">得分</th>
                  </tr>
                </thead>
                <tbody>
                  {answerSummary.map((item) => (
                    <tr key={item.qId}>
                      <td>{item.qId}</td>
                      <td>{item.questionText}</td>
                      <td>{item.answerLabel}</td>
                      <td>{item.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

        {(recommendedActions.length > 0 || recommendedNextScales.length > 0 || workflowSignals.sleepSignal) ? (
          <div className="rounded-2xl border border-[#DCE7F5] bg-[#F7FAFD] p-5 mb-6">
            <h4 className="font-bold text-[#162033] mb-3 flex items-center gap-2">
              <Shield className="w-5 h-5 text-[#2F6BFF]" />
              后续建议
            </h4>
            <div className="space-y-2 text-sm text-[#415168]">
              {recommendedActions.map((action, index) => (
                <p key={`${action}-${index}`} className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-[#2F6BFF] mt-0.5 shrink-0" />
                  <span>{action}</span>
                </p>
              ))}
              {workflowSignals.sleepSignal ? (
                <p className="flex items-start gap-2">
                  <MoonStar className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                  <span>已标记“睡眠异常线索”，建议与情绪结果联合查看。</span>
                </p>
              ) : null}
            </div>
            {recommendedNextScales.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {recommendedNextScales.map((code) => (
                  <span key={code} className="rounded-full bg-white border border-[#D8E5FF] px-3 py-1 text-xs font-medium text-[#5B78C7]">
                    建议补做 {code}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {authority ? (
          <div className="rounded-2xl border border-[#E2E8F0] bg-white p-5 mb-6">
            <h4 className="font-bold text-[#162033] mb-3">量表依据</h4>
            <div className="space-y-2 text-sm text-[#415168]">
              {authority.originalPaper ? <p><span className="font-medium text-[#162033]">原始文献：</span>{authority.originalPaper}</p> : null}
              {authority.validatedPopulation ? <p><span className="font-medium text-[#162033]">适用人群：</span>{authority.validatedPopulation}</p> : null}
              {authority.licenseNote ? <p><span className="font-medium text-[#162033]">使用说明：</span>{authority.licenseNote}</p> : null}
              {authority.sourceUrl ? (
                <p>
                  <span className="font-medium text-[#162033]">来源链接：</span>
                  <a href={authority.sourceUrl} target="_blank" rel="noreferrer" className="text-[#2F6BFF] hover:underline break-all">
                    {authority.sourceUrl}
                  </a>
                </p>
              ) : null}
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
