import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronRight, ChevronLeft, Brain, Shield, Activity, Loader, TrendingDown
} from 'lucide-react';
import {
  submitScaleAnswers,
  fetchScaleTaskResult,
  type ScaleTask,
} from '../api';
import {
  getScaleByCode,
  getScaleMeta,
  loadScalesData,
  type ScaleDefinition,
} from '../scales';
import ActionCapsuleButton from '../components/ActionCapsuleButton';

export default function ScaleAnswerPage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();

  const [task, setTask] = useState<ScaleTask | null>(null);
  const [scale, setScale] = useState<ScaleDefinition | null>(null);
  const [questions, setQuestions] = useState<{ id: number; text: string; options: { label: string; score: number }[] }[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [taskLoading, setTaskLoading] = useState(true);

  const QUESTIONS_PER_PAGE = 5;

  // 加载任务数据（从后端 API）+ 量表题目（从本地）
  useEffect(() => {
    if (!taskId) {
      navigate('/scale');
      return;
    }

    const loadTaskAndScale = async () => {
      setTaskLoading(true);
      setSubmitError(null);
      try {
        // 初始化量表数据（如果尚未加载）
        await loadScalesData();

        const taskData = await fetchScaleTaskResult(Number(taskId));
        setTask(taskData);
        setAnswers({});
        setCurrentPage(0);

        const scaleCode = taskData.scaleCode;
        if (!scaleCode) {
          setSubmitError('任务缺少量表代码，无法加载题目');
          return;
        }

        const scaleData = getScaleByCode(scaleCode);
        if (!scaleData) {
          setSubmitError('无法找到对应的量表数据');
          return;
        }

        setScale(scaleData);
        // 将本地题目格式转为前端期望格式: {id, text, options: [{label, score}]}
        setQuestions(scaleData.questions.map((q: any) => ({
          id: q.id,
          text: q.text,
          options: q.options.map((o: any) => ({ label: o.label, score: o.value })),
        })));
      } catch (err) {
        console.error('加载任务或量表题目失败:', err);
        setSubmitError('加载任务失败，请检查网络连接');
      } finally {
        setTaskLoading(false);
      }
    };

    loadTaskAndScale();
  }, [taskId, navigate]);

  const totalPages = Math.ceil(questions.length / QUESTIONS_PER_PAGE);
  const currentQuestions = questions.slice(currentPage * QUESTIONS_PER_PAGE, (currentPage + 1) * QUESTIONS_PER_PAGE);
  const progress = questions.length > 0 ? (Object.keys(answers).length / questions.length) * 100 : 0;

  const handleAnswer = (questionId: number, score: number) => {
    setAnswers(prev => ({ ...prev, [questionId]: score }));
  };

  const handleSubmit = async () => {
    if (!task || !scale) return;

    setIsSubmitting(true);
    setSubmitError(null);

    const answersList = questions.map(q => ({
      qId: q.id,
      score: answers[q.id] ?? 0,
    }));

    try {
      await submitScaleAnswers(Number(task.id), answersList);
      navigate(`/scale/result/${task.id}`);
    } catch (err) {
      console.error('提交失败:', err);
      setSubmitError(err instanceof Error ? err.message : '提交失败，请稍后重试');
      setIsSubmitting(false);
    }
  };

  const handleBack = () => {
    navigate('/scale');
  };

  const allAnswered = questions.length > 0 && questions.every(q => answers[q.id] !== undefined);

  // 获取量表图标
  const ScaleIcon = ({ type }: { type: string }) => {
    switch (type) {
      case 'suicide': return <Shield className="w-6 h-6 text-white" />;
      case 'depression': return <Brain className="w-6 h-6 text-white" />;
      case 'anxiety': return <Activity className="w-6 h-6 text-white" />;
      case 'hopelessness': return <TrendingDown className="w-6 h-6 text-white" />;
      default: return <Brain className="w-6 h-6 text-white" />;
    }
  };

  const getScaleDisplayInfo = (code?: string) => {
    if (!code) return { bgColor: 'bg-purple-500' };
    const meta = getScaleMeta(code);
    if (!meta) return { bgColor: 'bg-purple-500' };
    return { bgColor: meta.bgColor };
  };

  if (taskLoading || !task || !scale) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 text-[#2F6BFF] mx-auto mb-4 animate-spin" />
          <p className="text-[#64748B]">加载中...</p>
          {submitError && (
            <p className="text-red-500 text-sm mt-2">{submitError}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full animate-fade-in space-y-5">
      {/* 顶部导航 */}
      <div className="flex items-center justify-between">
        <ActionCapsuleButton onClick={handleBack} variant="neutral" icon={<ArrowLeft className="w-5 h-5" />}>
          返回任务列表
        </ActionCapsuleButton>
        <div className="flex items-center gap-3">
          <span className={`px-4 py-1.5 ${getScaleDisplayInfo(scale.code).bgColor} bg-opacity-20 text-[#162033] rounded-full text-sm font-medium`}>{scale.name}</span>
          <span className="text-sm text-[#64748B]">
            进度 {Math.round(progress)}%
          </span>
        </div>
      </div>

      {/* 进度条 */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[#162033]">答题进度</span>
          <span className="text-sm text-[#64748B]">{Object.keys(answers).length} / {questions.length} 题已答</span>
        </div>
        <div className="h-2 bg-[#E2E8F0] rounded-full overflow-hidden">
          <div className="h-full bg-[#2F6BFF] rounded-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
        </div>
      </div>

      {/* 当前任务信息 */}
      <div className="bg-[#F7FAFD] rounded-xl border border-[#DCE7F5] p-4 flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl ${getScaleDisplayInfo(scale.code).bgColor} flex items-center justify-center`}>
          <ScaleIcon type={scale.category} />
        </div>
        <div>
          <p className="font-bold text-[#162033]">{task.taskName}</p>
          <p className="text-sm text-[#64748B]">评估用户：{(task as any).userName || (task as any).userAlias || '用户'} · {scale.full_name || scale.name}</p>
        </div>
      </div>

      {/* 题目列表 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-[#162033]">
            问题 {currentPage * QUESTIONS_PER_PAGE + 1}～{Math.min((currentPage + 1) * QUESTIONS_PER_PAGE, questions.length)}（共{questions.length}题）
          </h3>
        </div>

        {currentQuestions.map((question, idx) => (
          <div key={question.id} className="bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
              <span className="w-8 h-8 rounded-full bg-[#F1F5FA] text-[#162033] text-sm font-semibold flex items-center justify-center shrink-0">
                {currentPage * QUESTIONS_PER_PAGE + idx + 1}
              </span>
              <p className="text-[#162033] font-medium leading-relaxed">{question.text}</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {question.options.map((option, oIdx) => (
                <button key={oIdx} onClick={() => handleAnswer(question.id, option.score)}
                  className={`p-3 rounded-xl border-2 text-sm font-medium transition-all ${
                    answers[question.id] === option.score
                      ? 'border-[#2F6BFF] bg-[#F3F8FF] text-[#162033]'
                      : 'border-[#E2E8F0] text-[#415168] hover:border-[#8FB4FF]'
                  }`}>
                  <span className="block">{option.label}</span>
                  <span className="block text-xs text-[#94A3B8] mt-1">{option.score}分</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 底部操作 */}
      <div className="flex items-center justify-between bg-white rounded-2xl border border-[#E2E8F0] p-5 shadow-sm">
        <ActionCapsuleButton onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
          disabled={currentPage === 0}
          variant="neutral"
          size="lg"
          icon={<ChevronLeft className="w-5 h-5" />}
        >
          上一页
        </ActionCapsuleButton>

        <div className="flex items-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => (
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${
                currentPage === i
                  ? 'bg-[#2F6BFF] text-white'
                  : 'bg-[#F1F5FA] text-[#415168] hover:bg-[#E2E8F0]'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>

        {currentPage < totalPages - 1 ? (
          <ActionCapsuleButton onClick={() => setCurrentPage(p => p + 1)} variant="solid" size="lg" icon={<ChevronRight className="w-5 h-5" />}>
            下一页
          </ActionCapsuleButton>
        ) : (
          <ActionCapsuleButton onClick={handleSubmit} disabled={!allAnswered || isSubmitting} variant="solid" tone="green" size="lg" icon={isSubmitting ? <Loader className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}>
            {isSubmitting ? '提交中...' : '提交评估'}
          </ActionCapsuleButton>
        )}
      </div>

      {submitError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm text-center">
          提交失败：{submitError}（将使用本地存储保存）
        </div>
      )}

      <div className="text-center text-sm text-[#94A3B8]">
        答题过程中不显示当前得分，提交后展示评估结果
      </div>
    </div>
  );
}
