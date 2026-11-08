'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect } from '@allingo/ui';
import { useRouter } from '@/i18n/navigation';
import { TIMED_DRILL_FALLBACK_SEC, TIMED_DRILL_SEC_PER_QUESTION } from '@allingo/schemas/api/attempt';
import { unwrap } from '@allingo/api-client';
import { getApi } from '@/lib/api';
import { getErrorCode, isApiError } from '@/lib/errors';
import type { Attempt } from '@/lib/types';
import { PRACTICE_SECTIONS as SECTIONS, practicePresetFrom, type PracticeSection as Section } from './practice-preset';

const COUNTS = [5, 10, 20] as const;
/** Giây mỗi câu cho timed_drill (`per_question_sec` 5–600); 'auto' = mặc định theo Part của API */
const PER_QUESTION = ['auto', 10, 15, 20, 30, 45, 60, 90] as const;
type PerQuestion = (typeof PER_QUESTION)[number];

/**
 * Luyện theo Part (GET /practice/questions → attempt drill). Từ khoá tìm qua Meilisearch/PG ở API, chỉ câu đã phát hành.
 */
export function PracticePage() {
  const t = useTranslations('practice');
  const ts = useTranslations('sections');
  const te = useTranslations('errors');
  const tr = useTranslations('result');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preset] = React.useState(() => practicePresetFrom(searchParams));
  const [section, setSection] = React.useState<Section>(preset.section ?? 'part5');
  const [focusArea, setFocusArea] = React.useState<{ subskill: string | null; topic: string | null }>({ subskill: preset.subskill, topic: preset.topic });
  const focusCode = focusArea.subskill ?? focusArea.topic;
  const focusKey = focusArea.subskill ? `subskills.${focusArea.subskill}` : focusArea.topic ? `topics.${focusArea.topic}` : null;
  const focusName = focusKey && tr.has(focusKey as never) ? tr(focusKey as never) : focusCode;
  const [keyword, setKeyword] = React.useState('');
  const [count, setCount] = React.useState<(typeof COUNTS)[number]>(10);
  const [timed, setTimed] = React.useState(false);
  const [perQuestion, setPerQuestion] = React.useState<PerQuestion>('auto');
  const defaultSec = TIMED_DRILL_SEC_PER_QUESTION[section] ?? TIMED_DRILL_FALLBACK_SEC;
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const start = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const q = keyword.trim();
    if (q && q.length < 2) {
      setError(t('keywordTooShort'));
      return;
    }
    setPending(true);
    try {
      const query = {
        program: 'toeic',
        section,
        count,
        timed: timed ? 'true' : 'false',
        ...(timed && perQuestion !== 'auto' ? { per_question_sec: perQuestion } : {}),
        ...(q ? { q } : {}),
        ...(focusArea.subskill ? { subskill: focusArea.subskill } : {}),
        ...(focusArea.topic ? { topic: focusArea.topic } : {}),
      };
      const attempt = unwrap(await getApi().GET('/practice/questions', { params: { query: query as never } })) as unknown as Attempt;
      router.push(`/attempts/${attempt.id}`);
    } catch (err) {
      setError(isApiError(err) && err.status === 404 ? t('noResults') : te(`codes.${getErrorCode(err)}`));
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </header>
      <Card>
        <CardHeader className="sr-only">
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={(e) => void start(e)} className="space-y-4" data-testid="practice-form">
            {preset.section ? (
              <p className="text-sm text-muted-foreground" data-testid="practice-preset">
                {t('presetHint')}
              </p>
            ) : null}
            {focusName ? (
              <Badge variant="secondary" className="gap-1.5 py-1 pr-1 text-sm" data-testid="practice-focus">
                {t('focusFilter', { name: focusName })}
                <button type="button" className="rounded-full p-0.5 hover:bg-background/60" onClick={() => setFocusArea({ subskill: null, topic: null })} aria-label={t('clearFocus')} data-testid="practice-focus-clear">
                  <X className="size-3.5" aria-hidden />
                </button>
              </Badge>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="practice-section">{t('section')}</Label>
                <NativeSelect id="practice-section" data-testid="practice-section" value={section} onChange={(e) => setSection(e.target.value as Section)}>
                  {SECTIONS.map((s) => (
                    <option key={s} value={s}>
                      {ts(s)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="practice-count">{t('count')}</Label>
                <NativeSelect id="practice-count" value={String(count)} onChange={(e) => setCount(Number(e.target.value) as (typeof COUNTS)[number])}>
                  {COUNTS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="practice-keyword">{t('keyword')}</Label>
              <Input id="practice-keyword" data-testid="practice-keyword" value={keyword} maxLength={100} placeholder={t('keywordPlaceholder')} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="space-y-2 rounded-lg border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="practice-timed">
                <input id="practice-timed" type="checkbox" className="size-4" checked={timed} onChange={(e) => setTimed(e.target.checked)} data-testid="practice-timed" />
                {t('timedPerQuestion')}
              </label>
              <p className="text-xs text-muted-foreground">{t('timedPerQuestionHint')}</p>
              {timed ? (
                <div className="space-y-1.5">
                  <Label htmlFor="practice-per-question">{t('perQuestionLabel')}</Label>
                  <NativeSelect id="practice-per-question" data-testid="practice-per-question" value={String(perQuestion)} onChange={(e) => setPerQuestion(e.target.value === 'auto' ? 'auto' : (Number(e.target.value) as PerQuestion))}>
                    {PER_QUESTION.map((p) => (
                      <option key={p} value={p}>
                        {p === 'auto' ? t('perQuestionAuto', { seconds: defaultSec }) : t('perQuestionSeconds', { seconds: p })}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
            </div>
            {error ? (
              <Alert variant="destructive" data-testid="practice-error">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" variant="navy" size="lg" className="w-full" disabled={pending} data-testid="practice-start">
              {pending ? t('starting') : t('start')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
