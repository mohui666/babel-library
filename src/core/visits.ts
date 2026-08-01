// ---------------------------------------------------------------------------
// 入馆统计（仅本地）：总次数与连续天数
// ---------------------------------------------------------------------------

const KEY = 'babel:visits';

interface VisitsData {
  days: string[];
  total: number;
}

function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface VisitStats {
  total: number;
  streak: number;
}

export function recordVisit(): VisitStats {
  let data: VisitsData = { days: [], total: 0 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) data = { ...data, ...JSON.parse(raw) };
  } catch {}

  const today = dayKey();
  if (!data.days.includes(today)) {
    data.days.push(today);
    data.total = (data.total || data.days.length - 1) + 1;
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
  }

  // 连续天数：从今天往回数
  let streak = 0;
  const set = new Set(data.days);
  const d = new Date();
  while (set.has(dayKey(d))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return { total: data.total || data.days.length, streak };
}
