// 统一时间格式化函数（北京时间）

// 完整日期时间格式化
export const formatDateTime = (dateStr: string | undefined | null): string => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return '-';
  }
};

// 短日期格式化（年月日）
export const formatDate = (dateStr: string | undefined | null): string => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return '-';
  }
};

// 短日期时间格式（带时分）
export const formatDateTimeShort = (dateStr: string | undefined | null): string => {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '-';
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Shanghai',
    });
  } catch {
    return '-';
  }
};

// 文档时间格式化（兼容原有逻辑）
export const formatDocTime = (uploadedAt?: string | null, createdAt?: string | null): string => {
  const uploaded = formatDateTime(uploadedAt || '');
  if (uploaded !== '-') return uploaded;
  return formatDateTime(createdAt || '');
};
