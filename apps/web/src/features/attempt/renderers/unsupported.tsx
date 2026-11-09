'use client';

import { Construction } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@allingo/ui';
import { QUESTION_TYPE_CODES } from '@allingo/schemas/question/content';
import type { QuestionTypeCode } from '@/lib/types';

/** Dạng chưa có renderer (drag_drop, map_label, ordering, dictation, essay, speaking, handwriting) – đợt sau (C4–C6) */
export function Unsupported({ type }: { type: string }) {
  const t = useTranslations('attempt');
  const tq = useTranslations('questionTypes');
  const known = (QUESTION_TYPE_CODES as readonly string[]).includes(type);
  return (
    <Alert variant="gold">
      <Construction aria-hidden />
      <AlertTitle>{t('unsupportedTitle')}</AlertTitle>
      <AlertDescription>{t('unsupportedDesc', { type: known ? tq(type as QuestionTypeCode) : type })}</AlertDescription>
    </Alert>
  );
}
