'use client';

import * as React from 'react';
import { CheckCircle2, CircleAlert, Volume2, XCircle } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { SrsCard } from '@allingo/schemas';
import { Badge, Button, cn, Input } from '@allingo/ui';
import { cardView, type CardView } from './card-view';
import { checkDictation, type DictationResult, type ReviewMode, type Side } from './session';

/**
 * Mặt thẻ ôn: vocab (từ + IPA + phát âm → nghĩa, ví dụ, collocations), dictation mini (nghe + nghĩa → gõ lại từ → so khớp),
 * thẻ lỗi (câu đã sai → đáp án đúng + giải thích + ghi chú). Không gọi API – dữ liệu từ `payload` của thẻ.
 */
export function FlashcardFace({
  card,
  side,
  mode,
  onFlip,
  onSpeak,
  speaking,
  dictation,
  onDictation,
}: {
  card: SrsCard;
  side: Side;
  mode: ReviewMode;
  onFlip: () => void;
  onSpeak: () => void;
  speaking: boolean;
  dictation: { typed: string; result: DictationResult | null };
  onDictation: (v: { typed: string; result: DictationResult | null }) => void;
}) {
  const t = useTranslations('flashcards');
  const locale = useLocale();
  const view = React.useMemo(() => cardView(card, locale), [card, locale]);
  const back = side === 'back';

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_20px_60px_-36px_rgba(11,31,75,0.5)] sm:p-8" data-testid="flashcard" data-card-id={card.id} data-side={side} data-card-state={card.state}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <Badge variant={card.state === 'new' ? 'gold' : 'secondary'}>{t(`state.${card.state}`)}</Badge>
        <span className="text-xs text-muted-foreground">{t(`cardType.${view.kind}`)}</span>
      </div>
      {view.kind === 'vocab' ? (
        <VocabFace view={view} back={back} mode={mode} onSpeak={onSpeak} speaking={speaking} dictation={dictation} onDictation={onDictation} onFlip={onFlip} />
      ) : view.kind === 'error' ? (
        <ErrorFace view={view} back={back} />
      ) : (
        <div className="space-y-3 text-center">
          <p className="text-2xl font-bold">{view.title}</p>
          {back && view.body ? <p className="text-muted-foreground">{view.body}</p> : null}
        </div>
      )}
    </div>
  );
}

function SpeakButton({ onSpeak, speaking, label }: { onSpeak: () => void; speaking: boolean; label: string }) {
  return (
    <Button variant="outline" size="icon" onClick={onSpeak} aria-label={label} title={label} disabled={speaking} data-testid="flashcard-speak">
      <Volume2 aria-hidden className={cn(speaking && 'animate-pulse')} />
    </Button>
  );
}

function VocabFace({
  view,
  back,
  mode,
  onSpeak,
  speaking,
  dictation,
  onDictation,
  onFlip,
}: {
  view: Extract<CardView, { kind: 'vocab' }>;
  back: boolean;
  mode: ReviewMode;
  onSpeak: () => void;
  speaking: boolean;
  dictation: { typed: string; result: DictationResult | null };
  onDictation: (v: { typed: string; result: DictationResult | null }) => void;
  onFlip: () => void;
}) {
  const t = useTranslations('flashcards');
  const inputId = React.useId();
  const showWord = mode === 'flashcard' || back;

  const check = () => {
    const result = checkDictation(dictation.typed, view.headword);
    onDictation({ typed: dictation.typed, result });
    onFlip();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-2 text-center">
        {showWord ? (
          <p className="text-3xl font-extrabold tracking-tight text-navy sm:text-4xl dark:text-foreground" data-testid="card-headword">
            {view.headword}
          </p>
        ) : (
          <p className="text-sm font-medium text-muted-foreground">{t('dictationPrompt')}</p>
        )}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {showWord && view.ipa ? <span>{view.ipa}</span> : null}
          {view.pos ? <span className="italic">{view.pos}</span> : null}
          <SpeakButton onSpeak={onSpeak} speaking={speaking} label={t('speak')} />
        </div>
        {mode === 'dictation' && !back && view.meaning ? <p className="text-lg font-semibold">{view.meaning}</p> : null}
      </div>

      {mode === 'dictation' ? (
        <div className="space-y-2">
          <label htmlFor={inputId} className="block text-sm font-medium">
            {t('dictationLabel')}
          </label>
          <div className="flex gap-2">
            <Input
              id={inputId}
              value={dictation.typed}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              readOnly={back}
              onChange={(e) => onDictation({ typed: e.target.value, result: null })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !back) {
                  e.preventDefault();
                  check();
                }
              }}
              data-testid="dictation-input"
            />
            {!back ? (
              <Button variant="navy" onClick={check} data-testid="dictation-check">
                {t('dictationCheck')}
              </Button>
            ) : null}
          </div>
          {back && dictation.result ? (
            <p
              className={cn('flex items-center gap-1.5 text-sm font-medium', dictation.result === 'correct' ? 'text-success' : dictation.result === 'close' ? 'text-accent-foreground' : 'text-destructive')}
              role="status"
              data-testid="dictation-result"
              data-result={dictation.result}
            >
              {dictation.result === 'correct' ? <CheckCircle2 className="size-4" aria-hidden /> : dictation.result === 'close' ? <CircleAlert className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
              {t(`dictationResult.${dictation.result}`, { word: view.headword })}
            </p>
          ) : null}
        </div>
      ) : null}

      {back ? (
        <div className="space-y-4 border-t border-border pt-4" data-testid="flashcard-back">
          {view.meaning ? (
            <p className="text-center text-xl font-semibold" data-testid="card-meaning">
              {view.meaning}
            </p>
          ) : null}
          {view.meaningEn && view.meaningEn !== view.meaning ? <p className="text-center text-sm text-muted-foreground">{view.meaningEn}</p> : null}
          {view.examples.length ? (
            <ul className="space-y-2">
              {view.examples.map((ex, i) => (
                <li key={i} className="rounded-lg bg-muted/60 px-3 py-2 text-sm">
                  <p className="font-medium" lang="en">
                    {ex.text}
                  </p>
                  {ex.translation ? <p className="mt-0.5 text-muted-foreground">{ex.translation}</p> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {view.collocations.length ? (
            <p className="text-sm">
              <span className="font-semibold">{t('collocations')}: </span>
              <span className="text-muted-foreground" lang="en">
                {view.collocations.join(' · ')}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ErrorFace({ view, back }: { view: Extract<CardView, { kind: 'error' }>; back: boolean }) {
  const t = useTranslations('flashcards');
  const ts = useTranslations('sections');
  return (
    <div className="space-y-4">
      {view.section ? <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{ts.has(view.section as never) ? ts(view.section as never) : view.section}</p> : null}
      {view.excerpt ? <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed">{view.excerpt}</p> : null}
      <p className="text-lg leading-relaxed font-medium">{view.stem || t('errorNoStem')}</p>
      {view.options.some((o) => o.text) ? (
        <ul className="grid gap-1.5 text-sm">
          {view.options.map((o) => (
            <li key={o.key} className={cn('rounded-md border px-3 py-1.5', back && o.key === view.correct ? 'border-success bg-success/10 font-semibold' : 'border-border')}>
              <span className="font-semibold">{o.key}.</span> {o.text}
            </li>
          ))}
        </ul>
      ) : null}
      {back ? (
        <div className="space-y-2 border-t border-border pt-4 text-sm" data-testid="flashcard-back">
          <p>
            <span className="font-semibold">{t('errorCorrect')}: </span>
            <span className="font-bold text-success">{view.correct}</span>
          </p>
          {view.explanation ? <p className="text-muted-foreground">{view.explanation}</p> : null}
          {view.evidence ? <p className="rounded-lg bg-muted/60 px-3 py-2 italic">{view.evidence}</p> : null}
          {view.note ? (
            <p>
              <span className="font-semibold">{t('errorNote')}: </span>
              {view.note}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
