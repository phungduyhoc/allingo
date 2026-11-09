/**
 * Nhớ lượt làm được mở từ task lộ trình (sessionStorage `allingo.plan-launch.v1`: attempt id → task id + trang quay về) để màn kết
 * quả hiện nút "Về Hôm nay/Lộ trình". Chỉ là tiện ích theo phiên – task vẫn do server tự đánh dấu xong (`plan_task_id`).
 * Mọi truy cập bọc try/catch (chế độ riêng tư / chặn storage → bỏ qua).
 */

const KEY = 'allingo.plan-launch.v1';
const MAX = 20;

export interface PlanLaunchRecord {
  task_id: string;
  /** C1: `/<program>/today` | `/<program>/plan` */
  return_to: string;
  at: number;
}

function read(): Record<string, PlanLaunchRecord> {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    return v && typeof v === 'object' ? (v as Record<string, PlanLaunchRecord>) : {};
  } catch {
    return {};
  }
}

export function rememberPlanLaunch(attemptId: string, rec: Omit<PlanLaunchRecord, 'at'>): void {
  try {
    const all = read();
    all[attemptId] = { ...rec, at: Date.now() };
    const trimmed = Object.entries(all)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MAX);
    window.sessionStorage.setItem(KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* storage không dùng được → bỏ qua */
  }
}

export function planLaunchOf(attemptId: string): PlanLaunchRecord | null {
  if (typeof window === 'undefined') return null;
  return read()[attemptId] ?? null;
}
