'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { listAuditLogs, s12Keys, type AuditLogItem } from '@/lib/s12-api';
import { DataTable, FilterBar, ShortId, useCursorList, When } from '@/features/admin/ui';
import { JsonBlock, useInitialParam } from './admin-ops-shell';
import { vnDayBound } from '@/lib/admin-format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nhật ký kiểm toán: lọc actor, action (tiền tố khi kết thúc bằng `.`/`*`, vd `user.`), loại/ID đối tượng, khoảng ngày (mặc định
 * server 30 ngày – partition pruning). before/after mở rộng từng dòng.
 */
export function AuditAdmin() {
  const t = useTranslations('adminOps');
  const entity = useInitialParam('entity');
  const [filter, setFilter] = React.useState({ action: '', actor: '', entity_type: '', entity_id: entity && UUID.test(entity) ? entity : '', from: '', to: '' });
  const query = {
    action: filter.action.trim() || undefined,
    actor: UUID.test(filter.actor.trim()) ? filter.actor.trim() : undefined,
    entity_type: filter.entity_type.trim() || undefined,
    entity_id: UUID.test(filter.entity_id.trim()) ? filter.entity_id.trim() : undefined,
    from: vnDayBound(filter.from, false),
    to: vnDayBound(filter.to, true),
  };
  const { q, rows } = useCursorList(s12Keys.admin('audit', query), (cursor) => listAuditLogs({ ...query, cursor }));
  return (
    <div className="space-y-4">
      <FilterBar
        value={filter}
        onApply={setFilter}
        testId="audit-filter"
        fields={[
          { name: 'action', label: t('audit.action'), placeholder: 'user.' },
          { name: 'actor', label: t('audit.actor'), placeholder: 'uuid' },
          { name: 'entity_type', label: t('audit.entityType'), placeholder: 'user' },
          { name: 'entity_id', label: t('audit.entityId'), placeholder: 'uuid' },
          { name: 'from', label: t('from'), type: 'date' },
          { name: 'to', label: t('to'), type: 'date' },
        ]}
      />
      <p className="text-xs text-muted-foreground">{t('audit.hint')}</p>
      <DataTable<AuditLogItem>
        list={{ q }}
        rows={rows}
        rowKey={(r) => String(r.id)}
        rowTestId="audit-row"
        rowAttrs={(r) => ({ 'data-action': r.action })}
        empty={t('empty')}
        columns={[
          { key: 'at', header: t('createdAt'), cell: (r) => <When iso={r.created_at} /> },
          { key: 'action', header: t('audit.action'), cell: (r) => <code className="font-mono text-xs font-semibold">{r.action}</code> },
          {
            key: 'actor',
            header: t('audit.actor'),
            cell: (r) => (
              <span className="text-xs">
                <ShortId id={r.actor_user_id} /> {r.actor_role ? <span className="text-muted-foreground">({r.actor_role})</span> : null}
              </span>
            ),
          },
          {
            key: 'entity',
            header: t('audit.entity'),
            cell: (r) => (
              <span className="text-xs">
                {r.entity_type ?? '—'} <ShortId id={r.entity_id} />
              </span>
            ),
          },
          {
            key: 'diff',
            header: t('audit.details'),
            className: 'max-w-sm',
            cell: (r) =>
              r.before || r.after ? (
                <details>
                  <summary className="cursor-pointer text-xs text-primary">{t('audit.show')}</summary>
                  {r.before ? (
                    <>
                      <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{t('audit.before')}</p>
                      <JsonBlock value={r.before} />
                    </>
                  ) : null}
                  {r.after ? (
                    <>
                      <p className="mt-1 text-[11px] font-semibold text-muted-foreground">{t('audit.after')}</p>
                      <JsonBlock value={r.after} />
                    </>
                  ) : null}
                </details>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </div>
  );
}
