/**
 * 量表模块
 *
 * 数据来源优先级：
 * 1. 后端 API (/api/scales/*) - 生产环境
 * 2. 本地 JSON 文件 (scales/*.json) - 开发/离线环境
 *
 * 量表评分类型：
 * - sum: 直接求和（PHQ-9, GAD-7, BHS, C-SSRS）
 * - weighted: 加权求和，SDS 使用标准分 = 粗分 × 1.25
 * - dimensional: 多维度评分，DASS-21 三个维度独立计算
 *
 * 特殊规则：
 * - PHQ-9: 第9题任何非0分需立即关注
 * - SDS: 第2,5,6,11,12,14,16,17,18,20题为反向计分
 * - BHS: 第1,3,5,6,8,10,13,15,19题为反向计分（选"是"得0分）
 * - C-SSRS: 模块化评分（意念严重程度 + 行为史）
 */

// 本地量表数据（直接从 FALLBACK_SCALES_META 构建）
// 完整题目数据通过 FALLBACK_QUESTIONS 提供
const FALLBACK_QUESTIONS: Record<string, ScaleDefinition> = {
  'PHQ-9': {
    code: 'PHQ-9',
    name: 'PHQ-9',
    category: 'depression',
    description: '患者健康问卷-9',
    questions: [
      { id: 1, text: '做事时提不起劲或没有兴趣', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 2, text: '感到心情低落、沮丧或绝望', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 3, text: '入睡困难、睡不好或睡眠过多', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 4, text: '感觉疲倦或没有活力', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 5, text: '食欲不振或吃太多', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 6, text: '觉得自己很糟或很失败', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 7, text: '对事物专注有困难', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 8, text: '动作或说话速度缓慢或烦躁不安', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 9, text: '有不如死掉或用某种方式伤害自己的念头', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
    ],
    scoring: { type: 'sum', max_score: 27, max_standard_score: 27 },
  },
  'GAD-7': {
    code: 'GAD-7',
    name: 'GAD-7',
    category: 'anxiety',
    description: '广泛性焦虑障碍量表',
    questions: [
      { id: 1, text: '感觉紧张、焦虑或急切', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 2, text: '无法停止或控制担忧', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 3, text: '对各种事情担忧过多', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 4, text: '很难放松下来', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 5, text: '由于不安而无法静坐', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 6, text: '变得容易烦恼或急躁', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
      { id: 7, text: '感到似乎将有可怕的事发生而害怕', type: 'single', options: [{ value: 0, label: '完全不会' }, { value: 1, label: '好几天' }, { value: 2, label: '一半以上天数' }, { value: 3, label: '几乎每天' }] },
    ],
    scoring: { type: 'sum', max_score: 21, max_standard_score: 21 },
  },
  'SDS': {
    code: 'SDS',
    name: 'SDS',
    category: 'depression',
    description: 'Zung抑郁自评量表',
    questions: [
      { id: 1, text: '我感到情绪沮丧，郁闷', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 2, text: '我感到早晨心情最好', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 3, text: '我一阵阵哭泣或想哭', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 4, text: '我夜间睡眠不好', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 5, text: '我吃饭像平时一样多', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 6, text: '我的性功能正常', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 7, text: '我感到体重减轻', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 8, text: '我为便秘烦恼', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 9, text: '我的心跳比平时快', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 10, text: '我无故感到疲劳', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 11, text: '我的头脑像往常一样清晰', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 12, text: '我做事情像平时一样不感到困难', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 13, text: '我坐卧不安，难以保持平静', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 14, text: '我感到未来有希望', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 15, text: '我比平时更容易激怒', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 16, text: '我决定要做的事很容易', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 17, text: '我感到自己是有用的和不可缺少的人', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 18, text: '我的生活很有意义', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
      { id: 19, text: '如果我死了，别人会过得更好', type: 'single', options: [{ value: 1, label: '很少有时间' }, { value: 2, label: '有时' }, { value: 3, label: '经常' }, { value: 4, label: '大多数时间' }] },
      { id: 20, text: '我仍旧喜爱自己平时喜爱的东西', type: 'single', options: [{ value: 4, label: '很少有时间' }, { value: 3, label: '有时' }, { value: 2, label: '经常' }, { value: 1, label: '大多数时间' }] },
    ],
    scoring: { type: 'weighted', max_score: 80, max_standard_score: 100 },
  },
  'BHS': {
    code: 'BHS',
    name: 'BHS',
    category: 'hopelessness',
    description: '贝克绝望量表',
    questions: [
      { id: 1, text: '我对未来充满希望', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
      { id: 2, text: '我无法将烦闷消除', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 3, text: '我对未来感到害怕', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 4, text: '我期待有更多好事发生在我身上', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
      { id: 5, text: '我感到前途光明', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
      { id: 6, text: '我无法想象我的一生会是什么样子', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 7, text: '我的前途渺茫', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 8, text: '我相信会有更多快乐时光', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
      { id: 9, text: '我很少想到好运会降临到我身上', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 10, text: '我的主要目标是获得美好的未来', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
      { id: 11, text: '我的前景是光明的', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
      { id: 12, text: '我无法想象每周会有愉快的事发生', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 13, text: '我相信会有不愉快的事情发生', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 14, text: '我的希望很渺茫', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 15, text: '我认为不太会有对我有益的事', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 16, text: '我对未来感到满意', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
      { id: 17, text: '美好时光对我来说是可望而不可及的', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 18, text: '我几乎不能指望会有真正让我快乐的事', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 19, text: '我的将来似乎是暗淡的', type: 'single', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 20, text: '我期待有更多好事发生', type: 'single', options: [{ value: 0, label: '是' }, { value: 1, label: '否' }] },
    ],
    scoring: { type: 'sum', max_score: 20, max_standard_score: 20 },
  },
  'DASS-21': {
    code: 'DASS-21',
    name: 'DASS-21',
    category: 'depression',
    description: '抑郁焦虑压力量表-21题版',
    questions: [
      { id: 1, text: '我感到时间过得太慢', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 2, text: '我感到口干舌燥', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 3, text: '我容易恼火和烦躁', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 4, text: '我感到忧郁、沮丧和不快乐', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 5, text: '我感到害怕', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 6, text: '我感到很难放松', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 7, text: '我对自己失去信心', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 8, text: '我感到紧张不安', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 9, text: '我感到内心惶恐', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 10, text: '我对一切事情都感到厌倦', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 11, text: '我忧心忡忡', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 12, text: '我无法容忍干扰', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 13, text: '我感到无法克服困难', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 14, text: '我感到坐立不安', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 15, text: '我感到紧张不安', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 16, text: '我提不起劲来', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 17, text: '我感到惊恐', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 18, text: '我感到容易激动', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 19, text: '我感到人生没有意义', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 20, text: '我感到心脏跳动得剧烈', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
      { id: 21, text: '我感到像绷紧的弦一样', type: 'single', options: [{ value: 0, label: '不符合' }, { value: 1, label: '有时符合' }, { value: 2, label: '常常符合' }, { value: 3, label: '总是符合' }] },
    ],
    scoring: { type: 'dimensional', max_score: 63, max_standard_score: 63 },
  },
  'C-SSRS': {
    code: 'C-SSRS',
    name: 'C-SSRS',
    category: 'suicide',
    description: '哥伦比亚自杀严重程度评定量表（筛查版）',
    questions: [
      { id: 1, text: '您是否希望自己死去？', type: 'binary', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 2, text: '您是否渴望伤害自己？', type: 'binary', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 3, text: '您是否想过自杀？', type: 'binary', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 4, text: '您是否制定了自杀计划？', type: 'binary', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 5, text: '您是否有过自杀行为？', type: 'binary', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
      { id: 6, text: '您是否有过非自杀性自伤行为？', type: 'binary', options: [{ value: 0, label: '否' }, { value: 1, label: '是' }] },
    ],
    scoring: { type: 'sum', max_score: 6, max_standard_score: 6 },
  },
};

// Use FALLBACK_QUESTIONS directly instead of LOCAL_SCALES

// API helper (reserved for future backend integration)
// const API_BASE = (() => {
//   const envValue = import.meta.env.VITE_API_BASE;
//   if (!envValue || envValue === 'undefined' || envValue === '') return '';
//   return envValue.replace(/\/api$/, '');
// })();
//
// async function apiGet<T>(endpoint: string): Promise<T> {
//   const res = await fetch(API_BASE + endpoint, {
//     headers: { 'Content-Type': 'application/json; charset=utf-8' },
//   });
//   if (!res.ok) throw new Error('API ' + endpoint + ' failed: ' + res.status);
//   return res.json() as Promise<T>;
// }

export interface ScaleQuestionOption {
  value: number;
  label: string;
}

export interface ScaleQuestion {
  id: number;
  text: string;
  type?: 'single' | 'binary' | 'multiple' | 'text';
  dimension?: string | null;
  reverse?: boolean;
  options: ScaleQuestionOption[];
  module?: string;
  severity_level?: number;
  description?: string;
  is_suicide_item?: boolean;
  is_suicide_related?: boolean;
}

export interface ScaleThreshold {
  min: number;
  max: number;
  level: string;
  label: string;
  label_en?: string;
  risk_level: string;
  suggestion?: string;
}

export interface ScaleScoring {
  type: string;
  max_score: number;
  max_standard_score?: number;
  dimensions?: unknown[];
  reverse_questions?: number[];
  suicide_risk_item?: number;
  suicide_risk_all?: boolean;
}

export interface ScaleDefinition {
  code: string;
  name: string;
  full_name?: string;
  version?: string;
  category?: 'suicide' | 'depression' | 'anxiety' | 'hopelessness';
  description: string;
  purpose?: string;
  estimated_minutes?: number;
  total_questions?: number;
  instruction?: string;
  scoring: ScaleScoring;
  thresholds?: ScaleThreshold[];
  special_rules?: Array<{
    item_id: number;
    condition: string;
    action: string;
    message: string;
  }>;
  questions?: ScaleQuestion[];
  interpretation?: string;
  references?: string;
  risk_levels?: Array<{
    level: string;
    label: string;
    condition: string;
    suggestion: string;
  }>;
  cutoff_screening?: number;
  cutoff_chinese_population?: number;
  questionCount?: number;
}

export interface ScaleMeta {
  code: string;
  name: string;
  full_name: string;
  category: 'depression' | 'anxiety' | 'suicide' | 'hopelessness';
  questionCount: number;
  maxScore: number;
  threshold: number;
  estimatedTime: string;
  color: string;
  bgColor: string;
  description: string;
}

const FALLBACK_SCALES_META: ScaleMeta[] = [
  { code: 'PHQ-9', name: 'PHQ-9', full_name: '患者健康问卷-9', category: 'depression', questionCount: 9, maxScore: 27, threshold: 10, estimatedTime: '约4分钟', color: 'bg-purple-100 text-purple-700', bgColor: 'bg-purple-500', description: '国际广泛使用的抑郁症筛查量表，含自杀意念条目' },
  { code: 'C-SSRS', name: 'C-SSRS', full_name: '哥伦比亚自杀严重程度评定量表（筛查版）', category: 'suicide', questionCount: 6, maxScore: 6, threshold: 3, estimatedTime: '约4分钟', color: 'bg-red-100 text-red-700', bgColor: 'bg-red-500', description: '专项自杀风险评定（国际临床金标准）' },
  { code: 'GAD-7', name: 'GAD-7', full_name: '广泛性焦虑障碍量表', category: 'anxiety', questionCount: 7, maxScore: 21, threshold: 10, estimatedTime: '约3分钟', color: 'bg-blue-100 text-blue-700', bgColor: 'bg-blue-500', description: '焦虑筛查（与抑郁共病评估，自杀风险调节因素）' },
  { code: 'DASS-21', name: 'DASS-21', full_name: '抑郁焦虑压力量表-21', category: 'depression', questionCount: 21, maxScore: 63, threshold: 21, estimatedTime: '约6分钟', color: 'bg-pink-100 text-pink-700', bgColor: 'bg-pink-500', description: '抑郁/焦虑/压力三维独立评估' },
  { code: 'SDS', name: 'SDS', full_name: 'Zung抑郁自评量表', category: 'depression', questionCount: 20, maxScore: 80, threshold: 53, estimatedTime: '约6分钟', color: 'bg-orange-100 text-orange-700', bgColor: 'bg-orange-500', description: '抑郁自评（国内经典量表）' },
  { code: 'BHS', name: 'BHS', full_name: '贝克绝望量表', category: 'hopelessness', questionCount: 20, maxScore: 20, threshold: 9, estimatedTime: '约5分钟', color: 'bg-indigo-100 text-indigo-700', bgColor: 'bg-indigo-500', description: '绝望感评估（自杀意念与行为的独立预测因子）' },
];

export const SCALES_META: ScaleMeta[] = FALLBACK_SCALES_META;

/**
 * 统一量表阈值规则（与 scales/*.json 保持一致）
 * 风险等级映射：normal=低风险, mild/low=低风险, moderate=中风险, severe/extremely_severe/high=高风险
 */
const UNIFIED_RULES: Record<string, ScaleThreshold[]> = {
  // PHQ-9: 0-27分，筛查阈值≥10分（中国人群建议≥7分）
  'PHQ-9': [
    { min: 0, max: 4, level: 'minimal', label: '无或极轻微抑郁', label_en: 'Minimal/No Depression', risk_level: 'low', suggestion: '继续保持良好的生活习惯，定期关注情绪变化' },
    { min: 5, max: 9, level: 'mild', label: '轻度抑郁', label_en: 'Mild Depression', risk_level: 'low', suggestion: '建议关注情绪变化，适当运动和休息，1个月后复测' },
    { min: 10, max: 14, level: 'moderate', label: '中度抑郁', label_en: 'Moderate Depression', risk_level: 'medium', suggestion: '建议咨询心理医生，考虑心理治疗或药物治疗' },
    { min: 15, max: 19, level: 'moderately_severe', label: '中重度抑郁', label_en: 'Moderately Severe Depression', risk_level: 'high', suggestion: '建议尽快就医，进行抗抑郁药物治疗联合心理治疗' },
    { min: 20, max: 27, level: 'severe', label: '重度抑郁', label_en: 'Severe Depression', risk_level: 'high', suggestion: '请立即就医，评估住院必要性' },
  ],
  // GAD-7: 0-21分，筛查阈值≥10分
  'GAD-7': [
    { min: 0, max: 4, level: 'normal', label: '无焦虑', label_en: 'Minimal Anxiety', risk_level: 'low', suggestion: '继续保持良好的心理状态' },
    { min: 5, max: 9, level: 'mild', label: '轻度焦虑', label_en: 'Mild Anxiety', risk_level: 'low', suggestion: '适当放松和运动，1个月后复测' },
    { min: 10, max: 14, level: 'moderate', label: '中度焦虑', label_en: 'Moderate Anxiety', risk_level: 'medium', suggestion: '建议咨询心理医生，考虑进一步评估和干预' },
    { min: 15, max: 21, level: 'severe', label: '重度焦虑', label_en: 'Severe Anxiety', risk_level: 'high', suggestion: '请立即就医，进行综合心理评估' },
  ],
  // SDS: 标准分 0-100分（粗分×1.25），筛查阈值≥53分
  'SDS': [
    { min: 0, max: 52, level: 'normal', label: '正常范围', label_en: 'Normal', risk_level: 'low', suggestion: '无明显抑郁症状' },
    { min: 53, max: 62, level: 'mild', label: '轻度抑郁', label_en: 'Mild Depression', risk_level: 'low', suggestion: '建议心理疏导和健康教育，1个月后复测' },
    { min: 63, max: 72, level: 'moderate', label: '中度抑郁', label_en: 'Moderate Depression', risk_level: 'medium', suggestion: '建议药物干预联合心理治疗' },
    { min: 73, max: 100, level: 'severe', label: '重度抑郁', label_en: 'Severe Depression', risk_level: 'high', suggestion: '请立即寻求专业心理/精神科帮助，评估住院必要性' },
  ],
  // BHS: 0-20分，自杀风险cutoff≥9分
  'BHS': [
    { min: 0, max: 3, level: 'normal', label: '正常范围', label_en: 'Normal Hopelessness', risk_level: 'low', suggestion: '无明显绝望感，继续保持' },
    { min: 4, max: 8, level: 'mild', label: '轻度绝望', label_en: 'Mild Hopelessness', risk_level: 'low', suggestion: '关注心理健康，可进行一般性心理疏导' },
    { min: 9, max: 14, level: 'moderate', label: '中度绝望', label_en: 'Moderate Hopelessness', risk_level: 'medium', suggestion: '建议进行心理评估和干预，关注自杀风险' },
    { min: 15, max: 20, level: 'severe', label: '重度绝望', label_en: 'Severe Hopelessness', risk_level: 'high', suggestion: '高自杀风险信号，建议立即进行专项自杀风险评估（C-SSRS）和临床干预' },
  ],
  // DASS-21: 总分0-63，三个维度各0-21独立计算
  // 这里使用总分作为综合指标，维度详情需单独计算
  'DASS-21': [
    { min: 0, max: 20, level: 'normal', label: '正常', label_en: 'Normal', risk_level: 'low', suggestion: '继续保持' },
    { min: 21, max: 40, level: 'mild', label: '轻度', label_en: 'Mild', risk_level: 'low', suggestion: '适当关注' },
    { min: 41, max: 56, level: 'moderate', label: '中度', label_en: 'Moderate', risk_level: 'medium', suggestion: '建议咨询心理医生' },
    { min: 57, max: 63, level: 'severe', label: '重度', label_en: 'Severe', risk_level: 'high', suggestion: '请立即就医' },
  ],
  // C-SSRS: 模块化评分，0-6分，风险等级基于最高阳性条目
  // 0=无风险, 1-2=低风险, 3-4=中风险, 5-6=高风险
  'C-SSRS': [
    { min: 0, max: 0, level: 'none', label: '无自杀风险', label_en: 'No Risk', risk_level: 'low', suggestion: '继续保持' },
    { min: 1, max: 2, level: 'low', label: '低风险', label_en: 'Low Risk', risk_level: 'low', suggestion: '关注情绪变化，提供心理健康支持' },
    { min: 3, max: 4, level: 'medium', label: '中风险', label_en: 'Medium Risk', risk_level: 'medium', suggestion: '建议咨询心理医生，加强随访频率' },
    { min: 5, max: 6, level: 'high', label: '高风险', label_en: 'High Risk', risk_level: 'high', suggestion: '请立即就医或联系心理危机干预热线' },
  ],
};

let _scalesLoaded = false;
let _scalesCache: Record<string, ScaleDefinition> = {};
let _scalesMetaCache: ScaleMeta[] = SCALES_META;
let _rulesCache: Record<string, ScaleThreshold[]> = UNIFIED_RULES;

export async function loadScalesData(): Promise<void> {
  if (_scalesLoaded) return;

  // 使用内置量表题目数据
  _scalesCache = { ...FALLBACK_QUESTIONS } as Record<string, ScaleDefinition>;
  _scalesMetaCache = SCALES_META;
  _rulesCache = UNIFIED_RULES;

  _scalesLoaded = true;
}

export function getScaleByCode(code: string): ScaleDefinition | undefined {
  return _scalesCache[code] || _scalesCache[code.replace('-', '')];
}

export function getScaleMeta(code: string): ScaleMeta | undefined {
  const clean = code.replace('-', '');
  return _scalesMetaCache.find(s => s.code === code || s.code.replace('-', '') === clean);
}

export function getAllScalesMeta(): ScaleMeta[] {
  return _scalesMetaCache;
}

export function getThresholdByScore(code: string, score: number): { label: string; risk_level: string; suggestion?: string } | null {
  const rules = _rulesCache[code] || UNIFIED_RULES[code];
  if (!rules) return null;
  for (const t of rules) {
    if (score >= t.min && score <= t.max) {
      return { label: t.label, risk_level: t.risk_level, suggestion: t.suggestion };
    }
  }
  return null;
}

export function getRiskColors(level: string): { bg: string; text: string; border: string; bgLight: string } {
  const COLORS: Record<string, { bg: string; text: string; border: string; bgLight: string }> = {
    normal: { bg: 'bg-green-500', text: 'text-green-700', border: 'border-green-500', bgLight: 'bg-green-50' },
    low:    { bg: 'bg-green-500', text: 'text-green-700', border: 'border-green-500', bgLight: 'bg-green-50' },
    medium: { bg: 'bg-yellow-500', text: 'text-yellow-700', border: 'border-yellow-500', bgLight: 'bg-yellow-50' },
    high:   { bg: 'bg-red-500', text: 'text-red-700', border: 'border-red-500', bgLight: 'bg-red-50' },
  };
  return COLORS[level] || COLORS['low'];
}

export function getRiskLevelByScore(code: string, score: number): { level: string; label: string; risk_level: string; suggestion?: string } | null {
  const rules = _rulesCache[code] || UNIFIED_RULES[code];
  if (!rules) return null;
  for (const t of rules) {
    if (score >= t.min && score <= t.max) {
      return { level: t.level, label: t.label, risk_level: t.risk_level, suggestion: t.suggestion };
    }
  }
  return null;
}

/**
 * 计算量表得分
 * 支持三种评分类型：sum, weighted, dimensional
 */
export function calculateScaleScore(
  code: string,
  answers: Record<number, number>,
  questions: ScaleQuestion[]
): { total: number; dimensions?: Record<string, number> } {
  switch (code) {
    case 'SDS': {
      // SDS: 粗分 = 正向题得分 + 反向题处理后得分
      // 反向题列表：2, 5, 6, 11, 12, 14, 16, 17, 18, 20
      // 反向计分：原始值 -> 5 - 原始值（0->4变成4->0的逻辑）
      // 但 SDS 选项是 1-4，正向题直接用，反向题用 5-原始值
      const reverseQuestions = [2, 5, 6, 11, 12, 14, 16, 17, 18, 20];
      let rawScore = 0;
      for (const q of questions) {
        const answer = answers[q.id];
        if (answer !== undefined) {
          if (reverseQuestions.includes(q.id)) {
            // 反向题：选项值 1-4，转换后为 4-答案（因为 1 分表示"没有或很少"，应该是高抑郁）
            rawScore += 5 - answer;
          } else {
            rawScore += answer;
          }
        }
      }
      // SDS 标准分 = 粗分 × 1.25，取整数
      return { total: Math.round(rawScore * 1.25) };
    }

    case 'BHS': {
      // BHS: 正向题（选"是"得1分），反向题（选"是"得0分）
      // 反向题：1, 3, 5, 6, 8, 10, 13, 15, 19
      const reverseQuestions = [1, 3, 5, 6, 8, 10, 13, 15, 19];
      let total = 0;
      for (const q of questions) {
        const answer = answers[q.id];
        if (answer !== undefined) {
          if (reverseQuestions.includes(q.id)) {
            // 反向题：选"是"(value=1)得0分，选"否"(value=0)得1分
            total += answer === 1 ? 0 : 1;
          } else {
            // 正向题：选"是"(value=1)得1分
            total += answer;
          }
        }
      }
      return { total };
    }

    case 'DASS-21': {
      // DASS-21: 三个维度独立计算
      const dimensions: Record<string, number> = {
        depression: 0,
        anxiety: 0,
        stress: 0,
      };
      const dimensionQuestions: Record<string, number[]> = {
        depression: [3, 5, 10, 13, 16, 17, 21],
        anxiety: [2, 4, 7, 9, 15, 19, 20],
        stress: [1, 6, 8, 11, 12, 14, 18],
      };

      for (const q of questions) {
        const answer = answers[q.id];
        if (answer !== undefined) {
          for (const [dim, qIds] of Object.entries(dimensionQuestions)) {
            if (qIds.includes(q.id)) {
              dimensions[dim] += answer;
            }
          }
        }
      }
      const total = dimensions.depression + dimensions.anxiety + dimensions.stress;
      return { total, dimensions };
    }

    case 'C-SSRS': {
      // C-SSRS: 取最高阳性条目的严重程度作为风险评分
      // 意念模块：1-4题，按严重程度递增
      // 行为模块：5-6题，任一阳性表示高风险
      let ideationScore = 0;
      let behaviorScore = 0;

      for (const q of questions) {
        const answer = answers[q.id];
        if (answer === 1) {
          if (q.id <= 4) {
            // 取最高阳性条目的编号作为意念严重程度
            ideationScore = Math.max(ideationScore, q.id);
          } else {
            // 行为条目阳性
            behaviorScore = q.id - 4; // Q5=1, Q6=2
          }
        }
      }

      // 综合风险评分：意念严重程度 + 行为指标
      // 0=无风险, 1-2=低, 3-4=中, 5-6=高
      const total = behaviorScore > 0 ? behaviorScore + 4 : ideationScore;
      return { total };
    }

    default:
      // PHQ-9, GAD-7: 直接求和
      let total = 0;
      for (const q of questions) {
        if (answers[q.id] !== undefined) {
          total += answers[q.id];
        }
      }
      return { total };
  }
}

/**
 * 获取量表的最高风险等级（综合多个维度）
 */
export function getHighestRiskLevel(riskLevels: string[]): string {
  const order = ['high', 'medium', 'low', 'normal'];
  let highest = 'normal';
  for (const level of riskLevels) {
    if (order.indexOf(level) < order.indexOf(highest)) {
      highest = level;
    }
  }
  return highest;
}

/**
 * 获取量表的维度阈值信息（用于 DASS-21）
 */
export function getDimensionThresholds(code: string): Array<{
  id: string;
  name: string;
  thresholds: Array<{ min: number; max: number; label: string; risk_level: string }>;
}> {
  if (code === 'DASS-21') {
    // DASS-21 共21题，每维度7题，每题0-3分，每维度最大21分
    // 阈值参考原文标准（按42题版推导），适配21题版
    return [
      {
        id: 'depression',
        name: '抑郁',
        thresholds: [
          { min: 0, max: 9, label: '正常', risk_level: 'low' },
          { min: 10, max: 13, label: '轻度抑郁', risk_level: 'low' },
          { min: 14, max: 20, label: '中度抑郁', risk_level: 'medium' },
          { min: 21, max: 21, label: '重度抑郁', risk_level: 'high' },
        ],
      },
      {
        id: 'anxiety',
        name: '焦虑',
        thresholds: [
          { min: 0, max: 7, label: '正常', risk_level: 'low' },
          { min: 8, max: 9, label: '轻度焦虑', risk_level: 'low' },
          { min: 10, max: 14, label: '中度焦虑', risk_level: 'medium' },
          { min: 15, max: 19, label: '重度焦虑', risk_level: 'high' },
          { min: 20, max: 21, label: '极重度焦虑', risk_level: 'high' },
        ],
      },
      {
        id: 'stress',
        name: '压力',
        thresholds: [
          { min: 0, max: 14, label: '正常', risk_level: 'low' },
          { min: 15, max: 18, label: '轻度压力', risk_level: 'low' },
          { min: 19, max: 25, label: '中度压力', risk_level: 'medium' },
          { min: 26, max: 21, label: '重度压力', risk_level: 'high' },
        ],
      },
    ];
  }
  return [];
}
