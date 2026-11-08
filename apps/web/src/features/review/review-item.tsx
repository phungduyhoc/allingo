'use client';

import * as React from 'react';
import { Check, Flag, Headphones, MessagesSquare, Quote, Users, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { explanationSchema } from '@allingo/schemas';
import { Badge, Button, cn } from '@allingo/ui';
import {
  asPublicContent,
  type AnswerInput,
  type ReviewItem as ReviewItemT,
  type TranscriptHighlight,
} from '@/lib/types';
import { QuestionRenderer } from '@/features/attempt/question-renderer';
import { QuestionStem } from '@/features/attempt/question-stem';
import { AudioPlayer } from '@/features/attempt/audio-player';
import { formatAnswer } from '@/lib/format-answer';
import { ExplainPanel } from './explain-panel';
import { NoteEditor } from '@/features/notes/note-editor';
import { ReportQuestionButton } from '@/features/content-report/report-question-button';
import { useOptionalTutor } from '@/features/tutor/tutor-provider';
import { useFlag } from '@/features/flags/flags-provider';
import { Transcript } from './transcript';
import { parseTranscript } from './transcript-format';

export interface ReviewMedia {
  resolve: (assetId: string | null | undefined, fallback: string) => string;
  refresh: () => Promise<void>;
}

/** Trình phát tự do + transcript tô dòng đang phát (segments khớp asset của trình phát) */
function ListenWithTranscript({
  src,
  assetId,
  transcript,
  evidence,
  label,
  onError,
  testId,
}: {
  src: string;
  assetId: string | null;
  transcript: TranscriptHighlight | null;
  evidence: readonly (string | null)[];
  label: string;
  onError: () => void;
  testId?: string;
}) {
  const [ms, setMs] = React.useState<number | null>(null);
  // Mốc thời gian của transcript thuộc về asset nào (passage nhóm hoặc audio câu) – chỉ tô khi đúng trình phát
  const synced = !!transcript && (!transcript.asset_id || !assetId || transcript.asset_id === assetId);
  return (
    <div className="space-y-2">
      <AudioPlayer src={src} label={label} onTime={synced ? setMs : undefined} onError={onError} data-testid={testId} />
      {transcript ? <Transcript transcript={transcript} evidence={evidence} activeMs={synced ? ms : null} /> : null}
    </div>
  );
}

/** Đầu nhóm Part 3/4 ở Xem lại: nghe lại cả hội thoại/bài nói + transcript (tô dẫn chứng của các câu trong nhóm) */
export function ReviewAudioGroup({ items, media }: { items: ReviewItemT[]; media: ReviewMedia }) {
  const t = useTranslations('review');
  const first = items[0]!;
  const passage = first.question.passage!;
  const transcript =
    items.map((i) => parseTranscript(i.transcript_highlight)).find((x) => x?.source === 'passage') ??
    (passage.body ? { text: passage.body, evidence: null, source: 'passage' as const } : null);
  const evidence = items.map((i) => parseTranscript(i.transcript_highlight)?.evidence ?? null);
  const numbers = items.map((i) => i.question.order_no);
  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="review-audio-group">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Headphones className="size-5 text-navy dark:text-accent" aria-hidden />
        <h3 className="font-semibold">{passage.title ?? t('audioGroup')}</h3>
        <span className="text-xs text-muted-foreground">
          · {t('audioGroupRange', { from: Math.min(...numbers), to: Math.max(...numbers) })}
        </span>
      </div>
      {passage.media_url ? (
        <ListenWithTranscript
          src={media.resolve(passage.media_asset_id, passage.media_url)}
          assetId={passage.media_asset_id ?? null}
          transcript={transcript}
          evidence={evidence}
          label={passage.title ?? t('audioGroup')}
          onError={() => void media.refresh()}
          testId="review-group-player"
        />
      ) : transcript ? (
        <Transcript transcript={transcript} evidence={evidence} />
      ) : null}
    </section>
  );
}

export function ReviewItemCard({
  item,
  number,
  attemptId,
  media,
  examLocked,
  onExamLocked,
}: {
  item: ReviewItemT;
  number: number;
  attemptId: string;
  media?: ReviewMedia;
  examLocked?: boolean;
  onExamLocked?: () => void;
}) {
  const t = useTranslations('review');
  const tt = useTranslations('tutor');
  const tutor = useOptionalTutor();
  // S11: kill-switch ff.ai.tutor tắt → ẩn "Hỏi gia sư"
  const tutorOn = useFlag('ff.ai.tutor');
  const ts = useTranslations('sections');
  const ta = useTranslations('attempt');
  const content = asPublicContent(item.question.content);
  const yourAnswer = (item.your_answer ?? null) as AnswerInput | null;
  const correct = item.is_correct;
  const audio = item.question.media.find((m) => m.kind === 'audio');
  const images = item.question.media.filter((m) => m.kind === 'image');
  const sectionKnown = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'].includes(
    item.question.section_code,
  );
  const cachedExplanation = item.explanation
    ? explanationSchema.safeParse({ ...item.explanation, cached: true })
    : null;
  const chosen = yourAnswer?.type === 'mcq_single' ? (yourAnswer.selected ?? undefined) : undefined;
  const transcript = parseTranscript(item.transcript_highlight);
  const audioScript = item.question.passage?.kind === 'audio_script';
  const resolve = media?.resolve ?? ((_id: string | null | undefined, fallback: string) => fallback);
  const onMediaError = () => void media?.refresh();

  return (
    <article
      className={cn(
        'rounded-xl border bg-card p-5',
        correct === true ? 'border-success/40' : correct === false ? 'border-destructive/40' : 'border-border',
      )}
      data-testid={`review-item-${number}`}
      data-correct={correct}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <span className="tabular text-sm font-semibold">{number}.</span>
        <Badge variant="secondary">
          {sectionKnown ? ts(item.question.section_code as 'part1').split(' · ')[0] : item.question.section_code}
        </Badge>
        {correct === true ? (
          <Badge variant="success">
            <Check aria-hidden />
            {t('correct')}
          </Badge>
        ) : correct === false ? (
          <Badge variant="destructive">
            <X aria-hidden />
            {t('wrong')}
          </Badge>
        ) : null}
        {item.flagged ? (
          <Badge variant="gold">
            <Flag aria-hidden />
          </Badge>
        ) : null}
        <span className="ml-auto inline-flex items-center gap-3 text-xs text-muted-foreground">
          {item.community_correct_rate !== null ? (
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" aria-hidden />
              {t('community', { rate: Math.round(item.community_correct_rate) })}
            </span>
          ) : null}
          {item.time_spent_ms !== null ? (
            <span className="tabular">{t('timeSpent', { seconds: Math.round(item.time_spent_ms / 1000) })}</span>
          ) : null}
        </span>
      </header>

      {item.question.passage?.body && !audioScript ? (
        <details className="mb-3 rounded-lg border border-border bg-background p-3 text-sm">
          <summary className="cursor-pointer font-medium">{item.question.passage.title ?? ta('passageTitle')}</summary>
          <div className="mt-2 leading-relaxed whitespace-pre-wrap" data-lookup="">
            {item.question.passage.body}
          </div>
        </details>
      ) : null}

      {images.length ? (
        <div className="mb-3 flex flex-wrap gap-3">
          {images.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element -- ảnh nội dung qua URL ký hết hạn (không tối ưu bằng next/image)
            <img
              key={m.id}
              src={resolve(m.id, m.url)}
              alt={ta('questionImageAlt', { number })}
              className="max-h-72 w-full max-w-lg rounded-lg border border-border bg-muted object-contain"
              data-testid="question-image"
            />
          ))}
        </div>
      ) : null}

      {/* Nghe lại từng câu: Part 1/2 kèm transcript câu (tô dòng đang phát); Part 3/4 – audio câu hỏi (transcript ở đầu nhóm) */}
      {audio ? (
        audioScript || transcript?.source === 'passage' ? (
          <AudioPlayer
            src={resolve(audio.id, audio.url)}
            compact
            label={ta('audioQuestionLabel', { number })}
            onError={onMediaError}
            className="mb-3"
          />
        ) : (
          <div className="mb-3">
            <ListenWithTranscript
              src={resolve(audio.id, audio.url)}
              assetId={audio.id}
              transcript={transcript}
              evidence={[]}
              label={ta('audioQuestionLabel', { number })}
              onError={onMediaError}
            />
          </div>
        )
      ) : transcript && transcript.source !== 'passage' ? (
        <Transcript transcript={transcript} className="mb-3" />
      ) : null}

      {content?.stem && content.type !== 'fill_blank' ? (
        <QuestionStem
          id={`q-${item.question.question_id}-stem`}
          stem={content.stem}
          className="mb-4 text-base leading-relaxed font-medium"
        />
      ) : null}

      {content ? (
        <QuestionRenderer
          questionId={item.question.question_id}
          content={content}
          answer={yourAnswer}
          onChange={() => undefined}
          review={{ correctAnswer: item.correct_answer, details: item.details, isCorrect: item.is_correct }}
        />
      ) : null}

      {transcript?.evidence ? (
        <p className="mt-3 flex gap-2 rounded-lg bg-accent/10 px-3 py-2 text-sm" data-testid="review-evidence">
          <Quote className="mt-0.5 size-4 shrink-0 text-accent-foreground dark:text-accent" aria-hidden />
          <span>
            <span className="font-semibold">{t('evidence')}: </span>
            <span data-lookup="">{transcript.evidence}</span>
          </span>
        </p>
      ) : null}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg bg-muted px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('yourAnswer')}</dt>
          <dd className={cn('font-semibold', correct === false && 'text-destructive')}>
            {yourAnswer && formatAnswer(yourAnswer) ? formatAnswer(yourAnswer) : t('noAnswer')}
          </dd>
        </div>
        <div className="rounded-lg bg-success/10 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('correctAnswer')}</dt>
          <dd className="font-semibold text-success">{formatAnswer(item.correct_answer)}</dd>
        </div>
      </dl>

      {/* Hàng thao tác: nút (Giải thích / Hỏi gia sư / Thêm ghi chú) nằm cạnh nhau; khối nội dung (giải thích, ghi chú) chiếm cả dòng */}
      <div className="mt-4 flex flex-wrap items-start gap-2 [&>*:not(button)]:w-full">
        <ExplainPanel
          questionVersionId={item.question.question_version_id}
          chosenOption={chosen}
          attemptId={attemptId}
          initial={cachedExplanation?.success ? cachedExplanation.data : null}
          examLocked={examLocked}
          onExamLocked={onExamLocked}
        />
        {/* S6: hỏi gia sư về câu này (ngữ cảnh câu + bài làm) – ẩn khi Exam Mode */}
        {tutor && tutorOn && !examLocked ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const correctKey = formatAnswer(item.correct_answer);
              // "Vì sao B sai?": lựa chọn sai của người học, hoặc phương án sai đầu tiên khi đã làm đúng
              const wrongOption =
                chosen && correct === false
                  ? chosen
                  : content?.type === 'mcq_single'
                    ? content.options.find((o) => o.key !== correctKey)?.key
                    : undefined;
              const suggestions = [
                ...(wrongOption ? [tt('suggestWhyWrong', { option: wrongOption })] : []),
                ...(correctKey ? [tt('suggestWhyCorrect', { option: correctKey })] : []),
                tt('suggestExample'),
                tt('suggestTrap'),
              ];
              tutor.openTutor({
                attemptId,
                questionVersionId: item.question.question_version_id,
                label: tt('contextQuestion', { number }),
                suggestions,
              });
            }}
            aria-label={tt('askQuestionLabel', { number })}
            data-testid="tutor-ask"
          >
            <MessagesSquare aria-hidden />
            {tt('askQuestion')}
          </Button>
        ) : null}
        {/* S12: báo lỗi câu theo phiên bản đã làm – ẩn khi đang có bài thi exam (Exam Mode) */}
        <ReportQuestionButton questionVersionId={item.question.question_version_id} number={number} hidden={examLocked} />
        <NoteEditor
          key={item.note?.id ?? 'none'}
          note={item.note ?? null}
          target={{
            question_version_id: item.question.question_version_id,
            question_id: item.question.question_id,
            attempt_id: attemptId,
          }}
          locked={examLocked}
        />
      </div>
    </article>
  );
}
