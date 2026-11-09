'use client';

import { ImageOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@allingo/ui';

export interface FigurePin {
  key: string;
  x: number;
  y: number;
  /** Chữ hiển thị trên ghim (A, B… hoặc số câu) */
  label: string;
  /** Mô tả vị trí bằng chữ (trình đọc màn hình) */
  description?: string;
}

/**
 * C2 – ảnh sơ đồ/bản đồ/mặt bằng có ghim vị trí (toạ độ % – co giãn theo ảnh, không tràn ngang). Phương án không cần nhìn: `alt`
 * là mô tả đầy đủ (bắt buộc ở schema), khối "Mô tả bằng chữ" mở được cho mọi người; ghim bấm được (bản đồ chọn chữ cái) là
 * `<button>` có nhãn "Vị trí A: …" – thao tác chính vẫn là ô chọn/ô nhập bên dưới (bàn phím, mobile).
 */
export function DiagramFigure({
  src,
  alt,
  pins,
  questionId,
  onPinClick,
  activePin,
  disabled,
}: {
  src: string | null;
  alt: string;
  pins: readonly FigurePin[];
  questionId: string;
  onPinClick?: (key: string) => void;
  activePin?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations('attempt.rl');
  return (
    <figure className="space-y-2" data-testid="rl-figure">
      <div className="relative mx-auto w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-muted">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- ảnh nội dung qua URL ký hết hạn (không tối ưu bằng next/image)
          <img src={src} alt={alt} className="block h-auto w-full" data-testid="rl-figure-image" />
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground" role="img" aria-label={alt}>
            <ImageOff className="size-6" aria-hidden />
            {t('imageUnavailable')}
          </div>
        )}
        {pins.map((p) =>
          onPinClick ? (
            <button
              key={p.key}
              type="button"
              disabled={disabled}
              onClick={() => onPinClick(p.key)}
              aria-label={p.description ?? t('pinLabel', { key: p.label })}
              aria-pressed={activePin === p.key}
              className={cn(
                'absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-navy text-sm font-bold text-white shadow outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-default sm:size-9',
                activePin === p.key && 'bg-accent text-accent-foreground',
              )}
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
              data-testid={`pin-${p.key}`}
            >
              {p.label}
            </button>
          ) : (
            <span
              key={p.key}
              aria-hidden
              className="absolute flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-navy text-xs font-bold text-white shadow"
              style={{ left: `${p.x}%`, top: `${p.y}%` }}
            >
              {p.label}
            </span>
          ),
        )}
      </div>
      <details className="rounded-md border border-border bg-background px-3 py-2 text-sm" data-testid="rl-figure-description">
        <summary className="cursor-pointer font-medium">{t('describeImage')}</summary>
        <p id={`q-${questionId}-figure-desc`} className="mt-2 leading-relaxed whitespace-pre-wrap">
          {alt}
        </p>
        {pins.some((p) => p.description) ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-5">
            {pins
              .filter((p) => p.description)
              .map((p) => (
                <li key={p.key}>{p.description}</li>
              ))}
          </ul>
        ) : null}
      </details>
    </figure>
  );
}
