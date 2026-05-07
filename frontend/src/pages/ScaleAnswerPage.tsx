import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Brain, ChevronLeft, ChevronRight, Check, Heart, Loader, Shield, Activity, TrendingDown,
} from 'lucide-react';
import { fetchScaleTaskResult, submitScaleAnswers, type ScaleTask } from '../api';
import { getScaleByCode, getScaleMeta, loadScalesData, type ScaleDefinition } from '../scales';
import ActionCapsuleButton from '../components/ActionCapsuleButton';

const OPTION_ACCENTS = [
  { dot: 'bg-emerald-500', pill: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  { dot: 'bg-amber-400', pill: 'bg-amber-50 text-amber-700 border-amber-100' },
  { dot: 'bg-orange-400', pill: 'bg-orange-50 text-orange-700 border-orange-100' },
  { dot: 'bg-rose-400', pill: 'bg-rose-50 text-rose-700 border-rose-100' },
  { dot: 'bg-sky-500', pill: 'bg-sky-50 text-sky-700 border-sky-100' },
];

function ScaleCategoryIcon({ type }: { type?: string }) {
  if (type === 'suicide') return <Shield className="w-7 h-7 text-white" />;
  if (type === 'anxiety') return <Activity className="w-7 h-7 text-white" />;
  if (type === 'hopelessness') return <TrendingDown className="w-7 h-7 text-white" />;
  return <Brain className="w-7 h-7 text-white" />;
}

function buildProgressCircle(progress: number) {
  return {
    background: `conic-gradient(#2f6bff ${progress * 3.6}deg, #e6edf8 0deg)`,
  };
}

export default function ScaleAnswerPage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();

  const [task, setTask] = useState<ScaleTask | null>(null);
  const [scale, setScale] = useState<ScaleDefinition | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      navigate('/scale');
      return;
    }

    const loadPage = async () => {
      setPageLoading(true);
      setErrorMessage(null);
      try {
        await loadScalesData();
        const taskData = await fetchScaleTaskResult(Number(taskId));
        const definition = getScaleByCode(taskData.scaleCode);
        if (!definition) {
          throw new Error(`未找到量表定义：${taskData.scaleCode}`);
        }
        setTask(taskData);
        setScale(definition);
        setAnswers({});
        setCurrentIndex(0);
      } catch (error) {
        console.error('加载量表答题页失败:', error);
        setErrorMessage(error instanceof Error ? error.message : '加载失败');
      } finally {
        setPageLoading(false);
      }
    };

    loadPage();
  }, [navigate, taskId]);

  const questions = scale?.questions || [];
  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const progressPercent = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const allAnswered = questions.length > 0 && questions.every((question) => answers[question.id] !== undefined);
  const scaleMeta = scale ? getScaleMeta(scale.code) : undefined;

  const currentAnswer = currentQuestion ? answers[currentQuestion.id] : undefined;

  const headerDescription = useMemo(() => {
    if (!scale) return '';
    return scale.purpose || scale.description || scale.interpretation || '';
  }, [scale]);

  const handleSelect = (questionId: number, value: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNext = async () => {
    if (!currentQuestion) return;
    if (currentAnswer === undefined) {
      setErrorMessage('请先完成当前题目');
      return;
    }
    setErrorMessage(null);

    if (currentIndex < questions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      return;
    }

    if (!task) return;
    setIsSubmitting(true);
    try {
      const payload = questions.map((question) => ({
        qId: question.id,
        score: answers[question.id],
      }));
      await submitScaleAnswers(task.id, payload);
      navigate(`/scale/result/${task.id}`);
    } catch (error) {
      console.error('提交量表失败:', error);
      setErrorMessage(error instanceof Error ? error.message : '提交失败，请稍后重试');
      setIsSubmitting(false);
    }
  };

  if (pageLoading || !task || !scale || !currentQuestion) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <Loader className="w-8 h-8 text-[#2F6BFF] mx-auto mb-4 animate-spin" />
          <p className="text-[#64748B]">加载量表中...</p>
          {errorMessage ? <p className="mt-2 text-sm text-red-500">{errorMessage}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 w-full bg-[linear-gradient(180deg,#f7fbff_0%,#f4f8ff_100%)] rounded-[32px] border border-[#E6EDF8] p-6 md:p-7 shadow-[0_18px_40px_rgba(47,107,255,0.06)]">
      <div className="mb-5 flex items-center justify-between">
        <button
          onClick={() => navigate('/scale')}
          className="inline-flex items-center gap-2 text-sm text-[#64748B] transition-colors hover:text-[#2F6BFF]"
        >
          <ArrowLeft className="w-4 h-4" />
          返回量表列表
        </button>
      </div>

      <section className="rounded-[28px] bg-white px-6 py-5 shadow-[0_12px_32px_rgba(15,23,42,0.05)] border border-[#EDF2FA]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-5">
            <div className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-[24px] ${scaleMeta?.bgColor || 'bg-blue-500'} shadow-[0_16px_32px_rgba(47,107,255,0.22)]`}>
              <ScaleCategoryIcon type={scale.category} />
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[32px] font-semibold leading-none text-[#162033]">{scale.name}</h1>
                <span className="rounded-full bg-[#EEF4FF] px-3 py-1 text-sm font-medium text-[#5B78C7]">
                  {task.dataSourceLabel || task.dataSource || '量表任务'}
                </span>
              </div>
              <p className="text-sm text-[#4A5B75]">{headerDescription}</p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-[#64748B]">
                <span>共 {questions.length} 题</span>
                <span>预计用时 {scale.estimated_minutes || scaleMeta?.estimatedTime?.replace('约', '') || '5分钟'}</span>
                <span>评估对象：{task.userAlias || task.userHash}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 self-end lg:self-auto">
            <div className="relative flex h-20 w-20 items-center justify-center rounded-full" style={buildProgressCircle(progressPercent)}>
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-[30px] font-semibold text-[#162033]">
                {progressPercent}%
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#4A5B75]">答题进度</p>
              <p className="text-[24px] font-semibold text-[#162033]">
                {Math.min(currentIndex + 1, questions.length)} / {questions.length}
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-5 rounded-2xl border border-[#D9E8FF] bg-[#F2F7FF] px-5 py-4 text-sm text-[#46638F]">
        请根据您在最近一周或量表说明周期内的实际感受作答，答案没有对错之分，如实作答有助于获得更准确的评估结果。
      </div>

      <section className="mt-5 flex-1 rounded-[28px] border border-[#EDF2FA] bg-white p-6 shadow-[0_12px_32px_rgba(15,23,42,0.05)]">
        <div className="mb-6 flex items-start justify-between gap-4 border-b border-[#EDF2FA] pb-5">
          <div>
            <p className="text-sm font-medium text-[#5B78C7]">
              第 {currentIndex + 1} 题 / 共 {questions.length} 题
            </p>
            <h2 className="mt-4 text-[30px] font-semibold leading-[1.35] text-[#162033]">
              {currentQuestion.text}
            </h2>
            <div className="mt-3 inline-flex rounded-full bg-[#EEF4FF] px-3 py-1 text-xs font-medium text-[#5B78C7]">
              单选题
            </div>
            {currentQuestion.note ? (
              <p className="mt-3 text-sm text-[#94A3B8]">{currentQuestion.note}</p>
            ) : null}
          </div>
          <Heart className="mt-1 h-5 w-5 shrink-0 text-[#C8D4E8]" />
        </div>

        <div className="space-y-4">
          {currentQuestion.options.map((option, index) => {
            const accent = OPTION_ACCENTS[index % OPTION_ACCENTS.length];
            const active = currentAnswer === option.value;
            return (
              <button
                key={`${currentQuestion.id}-${option.value}-${index}`}
                type="button"
                onClick={() => handleSelect(currentQuestion.id, option.value)}
                className={`flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all ${
                  active
                    ? 'border-[#2F6BFF] bg-[#F5F9FF] shadow-[0_10px_26px_rgba(47,107,255,0.10)]'
                    : 'border-[#EDF2FA] bg-white hover:border-[#BCD4FF] hover:bg-[#FBFDFF]'
                }`}
              >
                <div className="flex items-center gap-4">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${active ? 'border-[#2F6BFF] bg-[#2F6BFF]' : 'border-[#D6E0F0] bg-white'}`}>
                    {active ? <Check className="h-4 w-4 text-white" /> : null}
                  </span>
                  <span className={`h-8 w-8 rounded-full ${accent.dot} opacity-85`} />
                  <div>
                    <p className="text-base font-medium text-[#162033]">
                      {String.fromCharCode(65 + index)}. {option.label}
                    </p>
                  </div>
                </div>
                <span className={`rounded-full border px-4 py-2 text-sm font-medium ${active ? 'border-[#C9DDFF] bg-white text-[#2F6BFF]' : accent.pill}`}>
                  {option.value} 分
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="mt-5 flex items-center justify-between rounded-[24px] bg-white px-5 py-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] border border-[#EDF2FA]">
        <ActionCapsuleButton
          onClick={handlePrev}
          disabled={currentIndex === 0}
          variant="neutral"
          size="lg"
          icon={<ChevronLeft className="w-4 h-4" />}
        >
          上一题
        </ActionCapsuleButton>

        <div className="text-sm text-[#94A3B8]">
          已完成 {answeredCount} / {questions.length} 题
        </div>

        <ActionCapsuleButton
          onClick={handleNext}
          disabled={isSubmitting}
          variant="solid"
          size="lg"
          icon={isSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
        >
          {currentIndex === questions.length - 1 ? (isSubmitting ? '提交中...' : '提交评估') : '下一题'}
        </ActionCapsuleButton>
      </div>

      {errorMessage ? (
        <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
          {errorMessage}
        </div>
      ) : null}

      {!allAnswered ? (
        <div className="mt-4 text-center text-sm text-[#94A3B8]">
          当前提交策略为一次性提交，需完成全部题目后生成评估结果。
        </div>
      ) : null}
    </div>
  );
}
