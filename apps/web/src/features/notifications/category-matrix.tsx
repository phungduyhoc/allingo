'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { DELIVERY_CHANNELS, NOTIFICATION_CATEGORIES, type NotificationCategories } from '@allingo/schemas';
import { Switch } from '@allingo/ui';

/**
 * Ma trận bật/tắt thông báo theo loại (học tập · thanh toán · khuyến mãi) × kênh (email · đẩy · trong ứng dụng) – S8.
 * Kênh tắt ở mức tổng (`channels`) thắng → ô của kênh đó bị mờ. Email giao dịch (biên lai, hoá đơn) server luôn gửi.
 * Dùng ở /settings/notifications và trang quản lý qua link email (/notifications/manage, chỉ cột email).
 */
export function CategoryMatrix({
  value,
  onChange,
  channels,
  only,
  disabled = false,
}: {
  value: NotificationCategories;
  onChange: (next: NotificationCategories) => void;
  channels?: Partial<Record<string, boolean>>;
  only?: readonly (typeof DELIVERY_CHANNELS)[number][];
  disabled?: boolean;
}) {
  const t = useTranslations('notifications');
  const id = React.useId();
  const cols = only ?? DELIVERY_CHANNELS;
  return (
    <fieldset className="space-y-2" data-testid="category-matrix">
      <legend className="text-sm font-semibold">{t('categoriesTitle')}</legend>
      <p className="text-xs text-muted-foreground">{t('categoriesDesc')}</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">
                <span className="sr-only">{t('categoriesTitle')}</span>
              </th>
              {cols.map((c) => (
                <th key={c} scope="col" className="px-2 py-2 text-center font-medium">
                  {t(`channelShort.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_CATEGORIES.map((cat) => (
              <tr key={cat} className="border-t border-border">
                <th scope="row" id={`${id}-${cat}`} className="py-2.5 pr-3 text-left font-medium">
                  {t(`category.${cat}`)}
                  <span className="block text-xs font-normal text-muted-foreground">{t(`categoryDesc.${cat}`)}</span>
                </th>
                {cols.map((ch) => {
                  const globalOff = channels ? channels[ch] === false : false;
                  return (
                    <td key={ch} className="px-2 py-2.5 text-center">
                      <Switch
                        checked={!!value[cat][ch]}
                        disabled={disabled || globalOff}
                        onCheckedChange={(v) => onChange({ ...value, [cat]: { ...value[cat], [ch]: v } })}
                        aria-label={t('categoryChannel', { category: t(`category.${cat}`), channel: t(`channelShort.${ch}`) })}
                        data-testid={`cat-${cat}-${ch}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">{t('transactionalNote')}</p>
    </fieldset>
  );
}
