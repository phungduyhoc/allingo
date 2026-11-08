/**
 * Tiện ích thuần cho trang admin vận hành (S12): che PII khi xem như người dùng; khoảng ngày (giờ VN) → ISO có offset cho bộ lọc
 * nhật ký kiểm toán (API nhận `date-time` – partition pruning theo khoảng).
 */

/** Che email/SĐT trong dữ liệu "xem như người dùng" (admin không cần PII để điều tra ticket) */
export function maskPii(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(maskPii);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => {
      if (typeof x === 'string' && /^(email|phone)$/i.test(k)) return [k, k.toLowerCase() === 'email' ? x.replace(/^(.{0,2})[^@]*(@.*)?$/, '$1***$2') : x.replace(/\d(?=\d{2})/g, '•')];
      return [k, maskPii(x)];
    }),
  );
}

/** Ngày lịch (YYYY-MM-DD, giờ VN) → ISO có offset +07:00 cho `from` (đầu ngày) / `to` (cuối ngày); sai dạng → undefined */
export function vnDayBound(day: string, end: boolean): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return `${day}T${end ? '23:59:59.999' : '00:00:00.000'}+07:00`;
}
