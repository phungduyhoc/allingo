'use client';

import { Construction } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@allingo/ui';
import type { QuestionTypeCode } from '@/lib/types';

/** 8 dạng còn lại (matching, drag_drop, map_label, ordering, dictation, essay, speaking, handwriting) – Sprint sau */
export function Unsupported({ type }: { type: string }) {
  const t = useTranslations('attempt');
  const tq = useTranslations('questionTypes');
  const known = ['mcq_single', 'mcq_multi', 'fill_blank', 'matching', 'drag_drop', 'map_label', 'tfng', 'ordering', 'dictation', 'essay', 'speaking', 'handwriting'].includes(type);
  return (
    <Alert variant="gold">
      <Construction aria-hidden />
      <AlertTitle>{t('unsupportedTitle')}</AlertTitle>
      <AlertDescription>{t('unsupportedDesc', { type: known ? tq(type as QuestionTypeCode) : type })}</AlertDescription>
    </Alert>
  );
}
