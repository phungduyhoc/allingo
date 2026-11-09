'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Tabs, TabsList, TabsTrigger } from '@allingo/ui';
import { useTestSets } from '@/lib/queries';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/states';
import { PageHeader } from '@/components/page-header';
import { TestSetCard } from './test-set-card';
import { StartAttemptDialog } from './start-attempt-dialog';
import { useStartTestSet } from './use-start-test-set';
import { QuotaLeft } from '@/features/quota/quota-ui';
import { useProgram } from '@/features/program/program-context';

const KINDS = ['all', 'mini', 'full', 'part_drill', 'diagnostic', 'topic_pack'] as const;
type Kind = (typeof KINDS)[number];

export function TestSetsPage({ initialKind }: { initialKind?: string }) {
  const t = useTranslations('testSets');
  const [kind, setKind] = React.useState<Kind>(KINDS.includes(initialKind as Kind) ? (initialKind as Kind) : 'all');
  const program = useProgram();
  const query = useTestSets(program, kind === 'all' ? undefined : kind);
  const ctl = useStartTestSet();

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {/* "Đề đầy đủ còn y lượt tháng này" (Free) – Pro không có dòng hạn mức → ẩn */}
      <QuotaLeft feature="full_test" className="sm:max-w-md" />
      <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
        <TabsList aria-label={t('title')}>
          {KINDS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {k === 'all' ? t('filterAll') : t(`kind.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {query.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.data.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.data.map((s) => (
            <TestSetCard key={s.id} summary={s} onOpen={(x) => void ctl.open(x)} busy={ctl.checking === s.id} />
          ))}
        </div>
      )}
      {ctl.checkError ? <ErrorState error={ctl.checkError} /> : null}
      <StartAttemptDialog ctl={ctl} />
    </div>
  );
}
