'use client';

import * as React from 'react';
import { CheckCircle2, ImagePlus, Info, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Label, NativeSelect, Spinner, Textarea } from '@allingo/ui';
import { usePathname } from '@/i18n/navigation';
import { getErrorCode } from '@/lib/errors';
import { buildFeedbackInput, checkScreenshot, FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX, imageFromClipboard, type FeedbackCategory, type ImageCheck } from '@/lib/feedback';
import { createFeedback, uploadImage } from '@/lib/s12-api';
import { latestTraceId } from '@/lib/telemetry/last-trace';

/**
 * Form góp ý in-app (S12) → `POST /feedback`: loại, nội dung, ảnh màn hình tuỳ chọn (chọn tệp hoặc dán Ctrl+V – không thư viện
 * chụp màn hình) tải qua `/uploads/presign` + PUT, tự gắn `trace_id` gần nhất + đường dẫn trang + phiên bản ứng dụng (hiển thị rõ
 * cho người dùng; không gửi email/SĐT). Ảnh xem trước bằng blob URL (CSP img-src có blob:), thu hồi khi đổi/đóng.
 */
export function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations('feedback');
  const te = useTranslations('errors');
  const pathname = usePathname();
  const id = React.useId();
  const [category, setCategory] = React.useState<FeedbackCategory>('bug');
  const [message, setMessage] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [imageError, setImageError] = React.useState<ImageCheck | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [state, setState] = React.useState<'idle' | 'uploading' | 'sending' | 'done'>('idle');
  const [doneId, setDoneId] = React.useState<string | null>(null);
  // trace gần nhất lấy lúc mở hộp thoại (request của chính hộp thoại không đè)
  const [traceId] = React.useState(() => latestTraceId());
  const fileInput = React.useRef<HTMLInputElement>(null);

  // Ảnh xem trước: blob URL theo tệp, thu hồi khi đổi tệp/đóng hộp thoại
  const preview = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  React.useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const pick = (f: File | null) => {
    if (!f) return;
    const check = checkScreenshot(f);
    setImageError(check === 'ok' ? null : check);
    if (check === 'ok') setFile(f);
  };

  const busy = state === 'uploading' || state === 'sending';
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const draftCheck = buildFeedbackInput({ category, message }, { pathname, traceId });
    if (!draftCheck.ok) {
      setFormError(t(`errors.${draftCheck.error}`));
      return;
    }
    try {
      let uploadId: string | null = null;
      if (file) {
        setState('uploading');
        uploadId = await uploadImage(file);
      }
      setState('sending');
      const built = buildFeedbackInput({ category, message, screenshotUploadId: uploadId }, { pathname, traceId });
      if (!built.ok) throw new Error(built.error);
      const created = await createFeedback(built.input);
      setDoneId(created.id);
      setState('done');
    } catch (err) {
      setState('idle');
      setFormError(te(`codes.${getErrorCode(err)}`));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} data-testid="feedback-dialog">
      <DialogContent
        onPaste={(e) => {
          const img = imageFromClipboard(e.clipboardData);
          if (img) {
            e.preventDefault();
            pick(img);
          }
        }}
      >
        <DialogClose aria-label={t('close')} />
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('desc')}</DialogDescription>
        </DialogHeader>
        {state === 'done' ? (
          <div className="space-y-4" role="status" data-testid="feedback-done">
            <p className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <span>
                <span className="block font-semibold">{t('thanks')}</span>
                {t('thanksDesc', { id: doneId?.slice(0, 8) ?? '' })}
              </span>
            </p>
            <DialogFooter>
              <Button variant="navy" onClick={() => onOpenChange(false)} data-testid="feedback-close">
                {t('close')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={submit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-cat`}>{t('category')}</Label>
              <NativeSelect id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)} data-testid="feedback-category">
                {FEEDBACK_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`categories.${c}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-msg`}>{t('message')}</Label>
              <Textarea
                id={`${id}-msg`}
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, FEEDBACK_MESSAGE_MAX))}
                rows={5}
                placeholder={t('messagePlaceholder')}
                aria-describedby={`${id}-count`}
                data-testid="feedback-message"
              />
              <p id={`${id}-count`} className="text-right text-xs text-muted-foreground tabular">
                {t('count', { count: message.length, max: FEEDBACK_MESSAGE_MAX })}
              </p>
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium">{t('screenshot')}</span>
              {preview ? (
                <div className="relative w-fit">
                  {/* eslint-disable-next-line @next/next/no-img-element -- ảnh xem trước cục bộ (blob:), không tối ưu bằng next/image */}
                  <img src={preview} alt={t('previewAlt')} className="max-h-40 rounded-lg border border-border object-contain" data-testid="feedback-preview" />
                  <Button type="button" variant="outline" size="icon-sm" className="absolute -top-2 -right-2 rounded-full" onClick={() => setFile(null)} aria-label={t('removeImage')}>
                    <X aria-hidden />
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
                    <ImagePlus aria-hidden />
                    {t('chooseImage')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t('pasteHint')}</span>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-label={t('chooseImage')}
                onChange={(e) => {
                  pick(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
                data-testid="feedback-file"
              />
              {imageError ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(`imageErrors.${imageError}`)}
                </p>
              ) : null}
            </div>
            <p className="flex gap-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="feedback-context">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                {t('contextNote', { page: (pathname || '/').slice(0, 60) })}
                {traceId ? ` ${t('contextTrace', { trace: traceId.slice(0, 8) })}` : ''}
              </span>
            </p>
            {formError ? (
              <p role="alert" className="text-sm font-medium text-destructive" data-testid="feedback-error">
                {formError}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('cancel')}
              </Button>
              <Button type="submit" variant="navy" disabled={busy} data-testid="feedback-submit">
                {busy ? <Spinner aria-hidden /> : null}
                {state === 'uploading' ? t('uploading') : state === 'sending' ? t('sending') : t('submit')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
