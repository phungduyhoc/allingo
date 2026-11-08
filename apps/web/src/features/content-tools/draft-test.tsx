'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Rocket, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Alert, AlertDescription, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Progress, Spinner, ToggleChip } from '@allingo/ui';
import { getErrorStatus, isApiError } from '@/lib/errors';
import { contentToolsKeys, getDraftTestJob, publishDraftTestSet, startDraftTest, type DraftTestInput, type DraftTestStarted } from '@/lib/content-tools-api';
import { useMe } from '@/lib/queries';
import { isReviewer } from '@/features/admin/is-admin';
import { StatTile } from '@/features/admin-ops/admin-ops-shell';
import { useJobPoll } from './excel-import';

const PARTS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'] as const;
const LEVELS = ['A2', 'B1', 'B2', 'C1'] as const;
const TOPICS = ['business', 'office', 'travel', 'logistics', 'hr', 'finance', 'technology', 'health', 'shopping', 'education'] as const;
/** Mặc định: đề mini Reading ngắn (Part 5 · 6 · 7 bộ đôi) – biên tập viên chỉnh tuỳ ý */
const DEFAULT_COUNTS: Record<(typeof PARTS)[number], string> = { part1: '', part2: '', part3: '', part4: '', part5: '10', part6: '4', part7: '5' };

/**
 * B2 – AI soạn nháp cả đề theo blueprint: số câu mỗi Part (Part nhóm chia theo kích thước nhóm của catalog), Part 7 bộ đôi/bộ ba,
 * phân bố độ khó, chủ đề → job `content.draft_test` (polling tiến độ) → tóm tắt (đã tạo, không hợp lệ, nghi trùng, verdict AI) →
 * duyệt các câu ở hàng chờ (lọc theo đề nháp) → phát hành đề nháp (teacher/admin; API chặn khi còn câu chưa duyệt xong).
 */
export function DraftTest({ onOpenQueue }: { onOpenQueue?: (testSetId: string) => void }) {
  const t = useTranslations('contentTools.generate');
  const ts = useTranslations('contentTools.generate.summary');
  const me = useMe();
  const [counts, setCounts] = React.useState(DEFAULT_COUNTS);
  const [kind, setKind] = React.useState<'mini' | 'full' | 'part_drill'>('mini');
  const [texts, setTexts] = React.useState('2');
  const [title, setTitle] = React.useState('');
  const [mix, setMix] = React.useState<Record<(typeof LEVELS)[number], string>>({ A2: '30', B1: '50', B2: '20', C1: '0' });
  const [topics, setTopics] = React.useState<string[]>(['logistics', 'office']);
  const [started, setStarted] = React.useState<DraftTestStarted | null>(null);
  const job = useJobPoll(contentToolsKeys.draftJob('poll'), started?.job_id ?? null, getDraftTestJob);
  const id = React.useId();
  const total = PARTS.reduce((n, p) => n + (Number(counts[p]) || 0), 0);

  const start = useMutation({
    mutationFn: () => {
      const sections = PARTS.filter((p) => Number(counts[p]) > 0).map((p) => ({ section_code: p, count: Number(counts[p]), ...(p === 'part7' ? { multi_passage_texts: Number(texts) } : {}) }));
      if (!sections.length) throw new Error(t('noParts'));
      const body: DraftTestInput = {
        program: 'toeic',
        kind,
        ...(title.trim() ? { title: { vi: title.trim(), en: title.trim() } } : {}),
        blueprint: { sections, difficulty_mix: Object.fromEntries(LEVELS.map((l) => [l, Number(mix[l]) || 0])), topics },
      };
      return startDraftTest(body);
    },
    onSuccess: (r) => setStarted(r),
  });
  const publish = useMutation({
    mutationFn: (testSetId: string) => publishDraftTestSet(testSetId),
    onSuccess: (r) => toast.success(t('published', { code: r.code })),
    onError: (err) => {
      if (getErrorStatus(err) === 409 && isApiError(err)) toast.error(t('publishBlocked', { count: Number((err.details as { count?: number } | undefined)?.count ?? 0) }));
    },
  });

  const status = job.data?.status ?? (started ? 'queued' : null);
  const progress = (job.data?.progress ?? null) as { phase?: string; done?: number; total?: number } | null;
  const result = job.data?.result ?? null;
  const pct = progress?.total ? Math.round(((progress.done ?? 0) / progress.total) * 100) : status === 'completed' ? 100 : 5;
  const phaseKey = status === 'completed' ? 'done' : (progress?.phase ?? 'queued');
  const startError = start.isError ? (start.error instanceof Error ? start.error.message : String(start.error)) : null;

  return (
    <div className="space-y-4" data-testid="draft-test">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles aria-hidden />
            {t('title')}
          </CardTitle>
          <CardDescription>{t('desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              start.mutate();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-program`}>{t('program')}</Label>
                <NativeSelect id={`${id}-program`} value="toeic" disabled>
                  <option value="toeic">TOEIC</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-kind`}>{t('kind')}</Label>
                <NativeSelect id={`${id}-kind`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="draft-kind">
                  {(['mini', 'full', 'part_drill'] as const).map((k) => (
                    <option key={k} value={k}>
                      {t(`kinds.${k}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-title`}>{t('titleVi')}</Label>
                <Input id={`${id}-title`} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} data-testid="draft-title" />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('parts')}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {PARTS.map((p) => (
                  <div key={p} className="space-y-1">
                    <Label htmlFor={`${id}-${p}`} className="text-xs">
                      {p.toUpperCase()}
                    </Label>
                    <Input id={`${id}-${p}`} type="number" min={0} max={100} inputMode="numeric" value={counts[p]} onChange={(e) => setCounts({ ...counts, [p]: e.target.value })} aria-label={t('partCount', { part: p.toUpperCase() })} data-testid={`draft-count-${p}`} className="h-9" />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-texts`} className="text-xs">
                    {t('multiTexts')}
                  </Label>
                  <NativeSelect id={`${id}-texts`} value={texts} onChange={(e) => setTexts(e.target.value)} className="h-9 w-40" data-testid="draft-texts">
                    {['1', '2', '3'].map((n) => (
                      <option key={n} value={n}>
                        {t(`texts.${n as '1'}`)}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <p className="text-sm font-medium" data-testid="draft-total">
                  {t('total', { count: total })}
                </p>
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('difficulty')}</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {LEVELS.map((l) => (
                  <div key={l} className="space-y-1">
                    <Label htmlFor={`${id}-mix-${l}`} className="text-xs">
                      {t('level', { level: l })}
                    </Label>
                    <Input id={`${id}-mix-${l}`} type="number" min={0} max={100} value={mix[l]} onChange={(e) => setMix({ ...mix, [l]: e.target.value })} className="h-9" data-testid={`draft-mix-${l}`} />
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('topics')}</legend>
              <div className="flex flex-wrap gap-2">
                {TOPICS.map((topic) => (
                  <ToggleChip key={topic} pressed={topics.includes(topic)} onPressedChange={(on) => setTopics(on ? [...topics, topic] : topics.filter((x) => x !== topic))} data-testid={`draft-topic-${topic}`}>
                    {topic}
                  </ToggleChip>
                ))}
              </div>
            </fieldset>
            {startError ? (
              <Alert variant="destructive" data-testid="draft-error">
                <AlertDescription>{startError}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" disabled={start.isPending || total === 0 || (!!started && status !== 'completed' && status !== 'failed')} data-testid="draft-start">
              {start.isPending ? <Spinner aria-hidden /> : <Sparkles aria-hidden />}
              {start.isPending ? t('starting') : t('start')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {started ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="draft-job" data-status={status ?? ''} aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('progressTitle')}</h3>
            <span className="text-xs text-muted-foreground">{t('code', { code: started.code })}</span>
          </div>
          <Progress value={pct} label={t(`phase.${phaseKey as 'done'}`)} tone={status === 'completed' ? 'success' : 'primary'} />
          <p className="text-sm" data-testid="draft-phase">
            {t(`phase.${phaseKey as 'done'}`)}
            {progress?.total ? ` · ${t('progress', { done: progress.done ?? 0, total: progress.total })}` : ''}
          </p>
          {status === 'failed' ? (
            <Alert variant="destructive">
              <AlertDescription>{t('failed', { error: job.data?.error ?? '' })}</AlertDescription>
            </Alert>
          ) : null}
          {result ? (
            <div className="space-y-3" data-testid="draft-result" data-created={result.summary.created}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatTile label={ts('created')} value={result.summary.created} tone="ok" testId="draft-created" />
                <StatTile label={ts('invalid')} value={result.summary.invalid} tone={result.summary.invalid ? 'warn' : 'default'} />
                <StatTile label={ts('duplicates')} value={result.summary.flagged_duplicates} tone={result.summary.flagged_duplicates ? 'warn' : 'default'} testId="draft-duplicates" />
                <StatTile label={ts('pass')} value={result.summary.verdicts.pass ?? 0} />
                <StatTile label={ts('needs_change')} value={result.summary.verdicts.needs_change ?? 0} />
                <StatTile label={ts('fail')} value={result.summary.verdicts.fail ?? 0} />
              </div>
              {(result.summary.shortfall as Array<{ section_code: string; requested: number; created: number }>).map((s) => (
                <p key={s.section_code} className="text-sm text-destructive">
                  {t('shortfall', { missing: s.requested - s.created, part: s.section_code.toUpperCase() })}
                </p>
              ))}
              <div className="flex flex-wrap gap-2">
                {onOpenQueue ? (
                  <Button variant="secondary" onClick={() => onOpenQueue(result.test_set_id)} data-testid="draft-open-queue">
                    {t('openQueue')}
                  </Button>
                ) : null}
                {isReviewer(me.data) ? (
                  <Button variant="outline" disabled={publish.isPending} onClick={() => publish.mutate(result.test_set_id)} data-testid="draft-publish">
                    <Rocket aria-hidden />
                    {t('publish')}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
