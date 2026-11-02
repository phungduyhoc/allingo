'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck, BookmarkPlus, Languages, Lock, Sparkles, TriangleAlert, Volume2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import type { DictionaryEntry } from '@allingo/schemas';
import { Badge, Button, cn, Skeleton, Spinner } from '@allingo/ui';
import { handleExamLockedError } from '@/lib/exam-lock';
import { getErrorCode, isApiError } from '@/lib/errors';
import { addSrsCard, fetchTts, lookupDictionary } from '@/lib/learning-api';
import { QuotaExceededNotice } from '@/features/quota/quota-ui';
import { lookupKey, type LookupTarget } from './selection';
import type { LookupSource } from './lookup-layer';

const VOICES = { us: 'en-US-neural-f', uk: 'en-GB-neural-f' } as const;
type Accent = keyof typeof VOICES;

/** URL TTS đã lấy (ký 10′) theo văn bản × giọng – dùng lại tới khi sắp hết hạn */
const ttsCache = new Map<string, { url: string; expiresAt: number }>();
const fresh = (iso: string | null | undefined) => !iso || Date.parse(iso) - Date.now() > 30_000;

async function pronounce(entry: DictionaryEntry, accent: Accent): Promise<void> {
  let url: string | null = accent === 'us' && entry.audio_url && fresh(entry.audio_expires_at) ? entry.audio_url : null;
  if (!url) {
    const key = `${accent}|${entry.headword.toLowerCase()}`;
    const hit = ttsCache.get(key);
    if (hit && hit.expiresAt - Date.now() > 30_000) url = hit.url;
    else {
      const tts = await fetchTts(entry.headword, VOICES[accent]);
      url = tts.url;
      ttsCache.set(key, { url, expiresAt: tts.expires_at ? Date.parse(tts.expires_at) : Date.now() + 9 * 60_000 });
    }
  }
  const audio = new Audio(url);
  await audio.play();
}

export const dictionaryKey = (target: Pick<LookupTarget, 'term' | 'context' | 'mode'>, locale: string, ai: string) =>
  ['dictionary', ...lookupKey(target), locale, ai] as const;

/**
 * Nội dung popover tra từ: GET /dictionary/lookup (cache TanStack theo từ × ngữ cảnh × locale) → headword, IPA US/UK + phát âm
 * (`audio_url` hoặc GET /tts), nghĩa, ví dụ, collocations, gợi ý khi gõ sai, bản dịch AI (nhãn "cần kiểm tra"), nút thêm thẻ SRS.
 * Câu dài (> 4 từ) → dịch câu bằng AI (`ai=always`, cache server → lần sau `cached: true`).
 */
export function LookupCard({
  target: initial,
  source,
  onClose,
}: {
  target: LookupTarget;
  source: LookupSource;
  onClose: () => void;
}) {
  const t = useTranslations('dictionary');
  const te = useTranslations('errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const [target, setTarget] = React.useState(initial);
  const [forceAi, setForceAi] = React.useState(false);
  const [playing, setPlaying] = React.useState<Accent | null>(null);
  const ai = target.mode === 'sentence' || forceAi ? 'always' : 'auto';
  const key = dictionaryKey(target, locale, ai);
  const q = useQuery({
    queryKey: key,
    // Không truyền AbortSignal: đóng/mở lại popover (hoặc StrictMode mount 2 lần) không huỷ rồi gọi lại – tránh dịch AI 2 lần
    queryFn: () => lookupDictionary({ q: target.term, context: target.context, ai }),
    staleTime: 10 * 60_000,
    retry: false,
  });

  const errCode = q.isError ? getErrorCode(q.error) : null;
  // 403 Exam Mode → khoá toàn cục (429 đã có toast chung từ QueryCache)
  React.useEffect(() => {
    if (q.isError) handleExamLockedError(q.error);
  }, [q.error, q.isError]);

  const add = useMutation({
    mutationFn: (entry: DictionaryEntry) =>
      addSrsCard({
        program: 'toeic',
        card_type: 'vocab',
        ...(entry.vocab_item_id ? { ref_id: entry.vocab_item_id } : { headword: entry.headword.slice(0, 100) }),
        source_type: source.type,
        ...(source.attemptId ? { source_id: source.attemptId } : {}),
        ...(target.context ? { context: target.context.slice(0, 300) } : {}),
      }),
    onSuccess: (card) => {
      qc.setQueryData<DictionaryEntry>(key, (prev) => (prev ? { ...prev, saved: true, srs_card_id: card.id } : prev));
      // Mục khác cùng headword (ngữ cảnh khác) cũng đã lưu
      const hw = q.data?.headword.toLowerCase();
      qc.setQueriesData<DictionaryEntry>({ queryKey: ['dictionary'] }, (prev) =>
        prev && hw && prev.headword.toLowerCase() === hw ? { ...prev, saved: true, srs_card_id: card.id } : prev,
      );
    },
    onError: (err) => {
      // 429 srs_new_cards → toast hạn mức chung (MutationCache); lỗi khác → báo ngắn
      if (!isApiError(err, 'quota_exceeded')) toast.error(t('addError'));
    },
  });

  const play = async (entry: DictionaryEntry, accent: Accent) => {
    setPlaying(accent);
    try {
      await pronounce(entry, accent);
    } catch {
      toast.error(t('playError'));
    } finally {
      setPlaying(null);
    }
  };

  const title =
    target.mode === 'sentence' ? t('sentenceTitle') : target.mode === 'phrase' ? t('phraseTitle') : t('title');
  const e = q.data;
  return (
    <div
      className="p-4 text-sm"
      data-testid="lookup-card"
      data-status={q.status}
      data-source={e?.source ?? ''}
      data-cached={e?.cached ?? ''}
      data-saved={e?.saved ?? ''}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-2 size-7"
          onClick={onClose}
          aria-label={t('close')}
          data-testid="lookup-close"
        >
          <X className="size-4" aria-hidden />
        </Button>
      </div>

      {q.isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label={t('loading')}>
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : q.isError ? (
        errCode === 'exam_mode_locked' ? (
          <p
            className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-muted-foreground"
            data-testid="lookup-locked"
          >
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('examLocked')}
          </p>
        ) : errCode === 'quota_exceeded' ? (
          <QuotaExceededNotice error={q.error} testId="lookup-quota" />
        ) : (
          <p className="flex items-start gap-2 text-destructive" data-testid="lookup-error" data-code={errCode ?? ''}>
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('error')} {te(`codes.${errCode ?? 'internal'}`)}
          </p>
        )
      ) : e ? (
        <EntryView
          entry={e}
          target={target}
          playing={playing}
          onPlay={(a) => void play(e, a)}
          onSuggestion={(hw) => setTarget({ term: hw, context: target.context, mode: 'word', wordCount: 1 })}
          onForceAi={() => setForceAi(true)}
        />
      ) : null}

      {e && target.mode !== 'sentence' && e.source !== 'none' ? (
        <div className="mt-3 border-t border-border pt-3">
          {e.saved ? (
            <p className="inline-flex items-center gap-1.5 font-medium text-success" data-testid="srs-saved">
              <BookmarkCheck className="size-4" aria-hidden />
              {add.isSuccess && add.data?.created ? t('added') : t('saved')}
            </p>
          ) : (
            <Button
              variant="navy"
              size="sm"
              onClick={() => add.mutate(e)}
              disabled={add.isPending}
              data-testid="srs-add"
            >
              {add.isPending ? <Spinner aria-hidden /> : <BookmarkPlus aria-hidden />}
              {add.isPending ? t('adding') : t('addToSrs')}
            </Button>
          )}
        </div>
      ) : null}
      {e?.attribution ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{t('source', { attribution: e.attribution })}</p>
      ) : null}
    </div>
  );
}

function EntryView({
  entry: e,
  target,
  playing,
  onPlay,
  onSuggestion,
  onForceAi,
}: {
  entry: DictionaryEntry;
  target: LookupTarget;
  playing: Accent | null;
  onPlay: (a: Accent) => void;
  onSuggestion: (hw: string) => void;
  onForceAi: () => void;
}) {
  const t = useTranslations('dictionary');
  const isAi = e.source === 'ai' && !!e.translation;
  const aiBadge = isAi ? (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge
        variant={e.translation!.needs_review ? 'gold' : 'secondary'}
        data-testid="lookup-ai-badge"
        data-needs-review={e.translation!.needs_review}
      >
        <Sparkles aria-hidden />
        {e.translation!.needs_review ? t('aiNeedsReview') : t('aiTranslation')}
      </Badge>
      {e.cached ? (
        <Badge variant="outline" data-testid="lookup-cached">
          {t('aiCached')}
        </Badge>
      ) : null}
    </span>
  ) : null;

  if (target.mode === 'sentence') {
    return (
      <div className="space-y-2">
        <p className="rounded-lg bg-muted px-3 py-2 leading-relaxed" lang="en" data-testid="lookup-sentence">
          {target.term}
        </p>
        {isAi ? (
          <>
            {aiBadge}
            <p className="leading-relaxed font-medium" data-testid="lookup-translation">
              {e.translation!.text}
            </p>
          </>
        ) : e.meaning_local ? (
          <p className="leading-relaxed font-medium" data-testid="lookup-translation">
            {e.meaning_local}
          </p>
        ) : (
          <p className="text-muted-foreground">{t('notFound', { term: target.term.slice(0, 40) })}</p>
        )}
      </div>
    );
  }

  const hasIpa = !!(e.ipa_us || e.ipa_uk);
  return (
    <div className="space-y-3">
      <div>
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-xl font-bold text-navy dark:text-foreground" lang="en" data-testid="lookup-headword">
            {e.headword}
          </span>
          {e.pos ? <span className="text-xs text-muted-foreground italic">{e.pos}</span> : null}
          {e.level ? <Badge variant="secondary">{t('level', { level: e.level })}</Badge> : null}
        </p>
        {hasIpa || e.source === 'dictionary' ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            {(['us', 'uk'] as const).map((a) => {
              const ipa = a === 'us' ? e.ipa_us : e.ipa_uk;
              return (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-0.5"
                  data-testid={`lookup-ipa-${a}`}
                >
                  <span className="text-[10px] font-bold text-muted-foreground">
                    {a === 'us' ? t('ipaUs') : t('ipaUk')}
                  </span>
                  {ipa ? <span className="font-mono text-xs">{ipa}</span> : null}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 rounded-full"
                    onClick={() => onPlay(a)}
                    disabled={playing !== null}
                    aria-label={t('play', { accent: a === 'us' ? t('ipaUs') : t('ipaUk') })}
                    data-testid={`lookup-play-${a}`}
                  >
                    {playing === a ? (
                      <Spinner className="size-3" aria-hidden />
                    ) : (
                      <Volume2 className="size-3.5" aria-hidden />
                    )}
                  </Button>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      {e.meanings.length ? (
        <section aria-label={t('meanings')}>
          <ol className="space-y-1" data-testid="lookup-meanings">
            {e.meanings.slice(0, 4).map((m, i) => (
              <li key={i} className="flex gap-2">
                <span className="tabular text-xs text-muted-foreground">{i + 1}.</span>
                <span>
                  {m.local ? <span className="font-semibold">{m.local}</span> : null}
                  {m.pos && m.pos !== e.pos ? (
                    <span className="text-xs text-muted-foreground italic"> ({m.pos})</span>
                  ) : null}
                  {m.en ? (
                    <span className="block text-xs text-muted-foreground" lang="en">
                      {m.en}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : isAi ? (
        <div className="space-y-1">
          {aiBadge}
          <p className="font-semibold" data-testid="lookup-translation">
            {e.translation!.text}
          </p>
        </div>
      ) : e.meaning_local ? (
        <p className="font-semibold">{e.meaning_local}</p>
      ) : null}

      {e.examples.length ? (
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('examples')}</p>
          <ul className="space-y-1.5" data-testid="lookup-examples">
            {e.examples.slice(0, 2).map((x, i) => (
              <li key={i} className="border-l-2 border-accent/70 pl-2">
                <span className="block italic" lang="en">
                  {x.text}
                </span>
                {x.translation ? <span className="block text-xs text-muted-foreground">{x.translation}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {e.collocations.length ? (
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('collocations')}</p>
          <ul className="flex flex-wrap gap-1.5" data-testid="lookup-collocations">
            {e.collocations.slice(0, 6).map((c) => (
              <li key={c} className="rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground" lang="en">
                {c}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {e.source === 'none' ? (
        <p className="text-muted-foreground" data-testid="lookup-not-found">
          {t('notFound', { term: target.term })}
        </p>
      ) : null}

      {e.suggestions.length && e.matched !== 'headword' && e.matched !== 'form' ? (
        <section>
          <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('suggestionsTitle')}</p>
          <ul className="flex flex-wrap gap-1.5" data-testid="lookup-suggestions">
            {e.suggestions.map((s) => (
              <li key={s.headword}>
                <button
                  type="button"
                  onClick={() => onSuggestion(s.headword)}
                  className={cn(
                    'rounded-full border border-primary/40 px-2.5 py-0.5 text-xs font-medium text-primary outline-none hover:bg-primary/10 focus-visible:ring-[3px] focus-visible:ring-ring/40',
                  )}
                  lang="en"
                  data-testid="lookup-suggestion"
                >
                  {s.headword}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {e.source === 'none' ? (
        <Button variant="outline" size="sm" onClick={onForceAi} data-testid="lookup-force-ai">
          <Languages aria-hidden />
          {t('translateWithAi')}
        </Button>
      ) : null}
    </div>
  );
}
