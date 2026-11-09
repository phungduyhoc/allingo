'use client';

import * as React from 'react';

/**
 * C3/S167 – số đầu tiên của câu catalog trong đề ("Questions 1–40"): renderer nhiều mục đánh số mục thứ k là `base + k`.
 * Mặc định 1 (C2 – đánh số trong câu, xem trước CMS/hàng chờ duyệt). Khối câu ở màn làm bài/xem lại đặt giá trị từ `number_start`.
 */
const NumberBaseContext = React.createContext(1);

export function NumberBase({ start, children }: { start: number; children: React.ReactNode }) {
  return <NumberBaseContext.Provider value={start}>{children}</NumberBaseContext.Provider>;
}

export function useNumberBase(): number {
  return React.useContext(NumberBaseContext);
}
