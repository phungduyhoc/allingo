'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { PROGRAM_CODES, PROMOTION_KINDS, promotionCreateInputSchema, promotionPatchInputSchema, type PromotionAdmin, type PromotionKind } from '@allingo/schemas';
import { Badge, Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Label, NativeSelect, Spinner, Switch } from '@allingo/ui';
import { adminKeys, createPromotion, listPromotions, patchPromotion } from '@/lib/admin-api';
import { formatVnd } from '@/lib/billing';
import { getErrorCode } from '@/lib/errors';
import { useLocalized } from '@/lib/localized';
import { DataTable, FilterBar, useCursorList, When } from './ui';

const PLAN_KINDS = ['monthly', 'yearly', 'lifetime', 'combo', 'credit_pack'] as const;

interface PromoDraft {
  code: string;
  kind: PromotionKind;
  value: string;
  name_vi: string;
  name_en: string;
  plan_codes: string;
  valid_from: string;
  valid_to: string;
  max_uses: string;
  per_user_limit: string;
  is_active: boolean;
  program_codes: string[];
  plan_kinds: string[];
  new_users_only: boolean;
  min_subtotal: string;
  standalone: boolean;
  credit_valid_days: string;
  trial_plan_code: string;
}

/** `datetime-local` (giờ VN) ↔ ISO có offset +07:00 */
const toLocalInput = (iso: string) => new Date(Date.parse(iso) + 7 * 3_600_000).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => (v ? `${v}:00+07:00` : '');

function draftOf(p: PromotionAdmin | null): PromoDraft {
  const now = new Date().toISOString();
  return {
    code: p?.code ?? '',
    kind: p?.kind ?? 'percent',
    value: p ? String(p.value) : '',
    name_vi: p?.name?.vi ?? '',
    name_en: p?.name?.en ?? '',
    plan_codes: p?.plan_codes.join(', ') ?? '',
    valid_from: toLocalInput(p?.valid_from ?? now),
    valid_to: toLocalInput(p?.valid_to ?? new Date(Date.now() + 30 * 86_400_000).toISOString()),
    max_uses: p?.max_uses ? String(p.max_uses) : '',
    per_user_limit: String(p?.per_user_limit ?? 1),
    is_active: p?.is_active ?? true,
    program_codes: p?.conditions.program_codes ?? [],
    plan_kinds: p?.conditions.plan_kinds ?? [],
    new_users_only: p?.conditions.new_users_only ?? false,
    min_subtotal: p?.conditions.min_subtotal ? String(p.conditions.min_subtotal) : '',
    standalone: p?.conditions.standalone ?? false,
    credit_valid_days: p?.conditions.credit_valid_days ? String(p.conditions.credit_valid_days) : '',
    trial_plan_code: p?.conditions.trial_plan_code ?? '',
  };
}

function bodyOf(d: PromoDraft) {
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  const name = d.name_vi || d.name_en ? { ...(d.name_vi ? { vi: d.name_vi } : {}), ...(d.name_en ? { en: d.name_en } : {}) } : undefined;
  const conditions = {
    ...(d.program_codes.length ? { program_codes: d.program_codes } : {}),
    ...(d.plan_kinds.length ? { plan_kinds: d.plan_kinds } : {}),
    ...(d.new_users_only ? { new_users_only: true } : {}),
    ...(num(d.min_subtotal) !== undefined ? { min_subtotal: num(d.min_subtotal) } : {}),
    ...(d.kind === 'credit_bonus' && d.standalone ? { standalone: true } : {}),
    ...(d.kind === 'credit_bonus' && num(d.credit_valid_days) !== undefined ? { credit_valid_days: num(d.credit_valid_days) } : {}),
    ...(d.kind === 'trial_days' && d.trial_plan_code.trim() ? { trial_plan_code: d.trial_plan_code.trim() } : {}),
  };
  return {
    kind: d.kind,
    value: Number(d.value),
    ...(name ? { name } : {}),
    plan_codes: d.plan_codes.split(',').map((s) => s.trim()).filter(Boolean),
    valid_from: fromLocalInput(d.valid_from),
    valid_to: fromLocalInput(d.valid_to),
    max_uses: num(d.max_uses) ?? null,
    per_user_limit: num(d.per_user_limit) ?? 1,
    is_active: d.is_active,
    conditions,
  };
}

/** Khuyến mãi: danh sách lọc + thống kê lượt (reserved/redeemed/released, tổng giảm, credit tặng), tạo/sửa (validate như server) */
export function PromotionsTab() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const loc = useLocalized();
  const [f, setF] = React.useState({ active: '', kind: '', q: '' });
  const query = { ...f, limit: 20 };
  const { q, rows } = useCursorList(adminKeys.promotions(query), (cursor) => listPromotions({ ...query, cursor }));
  const [editing, setEditing] = React.useState<PromotionAdmin | 'new' | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar
          value={f}
          onApply={setF}
          fields={[
            { name: 'active', label: t('active'), type: 'select', options: [{ value: 'true', label: t('yes') }, { value: 'false', label: t('no') }] },
            { name: 'kind', label: t('kind'), type: 'select', options: PROMOTION_KINDS.map((k) => ({ value: k, label: t(`promoKind.${k}`) })) },
            { name: 'q', label: t('search'), placeholder: 'WELCOME' },
          ]}
        />
        <Button variant="gold" onClick={() => setEditing('new')} data-testid="promo-new">
          <Plus aria-hidden />
          {t('promoNew')}
        </Button>
      </div>
      <DataTable
        list={{ q }}
        rows={rows}
        rowKey={(p) => p.id}
        rowTestId="promo-row"
        rowAttrs={(p) => ({ 'data-code': p.code })}
        empty={t('empty')}
        columns={[
          { key: 'code', header: t('code'), cell: (p) => <code className="font-mono font-semibold">{p.code}</code> },
          { key: 'name', header: t('name'), cell: (p) => (p.name ? loc(p.name) : '—') },
          { key: 'kind', header: t('kind'), cell: (p) => `${t(`promoKind.${p.kind}`)} · ${p.kind === 'percent' ? `${p.value}%` : p.kind === 'fixed' ? formatVnd(p.value, locale) : p.value}` },
          { key: 'valid', header: t('validity'), cell: (p) => <span className="text-xs"><When iso={p.valid_from} /> → <When iso={p.valid_to} /></span> },
          { key: 'uses', header: t('uses'), cell: (p) => `${p.used_count}${p.max_uses ? `/${p.max_uses}` : ''} · ${t('perUser', { n: p.per_user_limit })}` },
          {
            key: 'stats',
            header: t('stats'),
            cell: (p) => (
              <span className="text-xs" data-testid="promo-stats">
                {t('promoStats', { reserved: p.stats.reserved, redeemed: p.stats.redeemed, released: p.stats.released })}
                <br />
                {formatVnd(p.stats.discount_total, locale)} · {t('promoCredits', { count: p.stats.credits_total })}
              </span>
            ),
          },
          { key: 'active', header: t('active'), cell: (p) => <Badge variant={p.is_active ? 'success' : 'muted'}>{p.is_active ? t('yes') : t('no')}</Badge> },
          {
            key: 'actions',
            header: '',
            cell: (p) => (
              <Button variant="ghost" size="icon-sm" aria-label={t('edit')} onClick={() => setEditing(p)} data-testid="promo-edit">
                <Pencil aria-hidden />
              </Button>
            ),
          },
        ]}
      />
      {editing ? <PromotionDialog key={editing === 'new' ? 'new' : editing.id} promotion={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function PromotionDialog({ promotion, onClose }: { promotion: PromotionAdmin | null; onClose: () => void }) {
  const t = useTranslations('admin');
  const te = useTranslations('errors');
  const qc = useQueryClient();
  const [d, setD] = React.useState<PromoDraft>(() => draftOf(promotion));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const set = <K extends keyof PromoDraft>(k: K, v: PromoDraft[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'program_codes' | 'plan_kinds', v: string) => setD((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  const save = useMutation({
    mutationFn: async () => {
      const body = bodyOf(d);
      if (promotion) {
        const parsed = promotionPatchInputSchema.safeParse(body);
        if (!parsed.success) throw Object.assign(new Error('invalid'), { issues: parsed.error.issues });
        return patchPromotion(promotion.id, parsed.data);
      }
      const parsed = promotionCreateInputSchema.safeParse({ ...body, code: d.code });
      if (!parsed.success) throw Object.assign(new Error('invalid'), { issues: parsed.error.issues });
      return createPromotion(parsed.data);
    },
    onSuccess: (p) => {
      toast.success(t('promoSaved', { code: p.code }));
      void qc.invalidateQueries({ queryKey: ['admin', 'billing', 'promotions'] });
      onClose();
    },
    onError: (err) => {
      const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues;
      if (issues) {
        setErrors(Object.fromEntries(issues.map((i) => [String(i.path[0] ?? 'form'), i.message])));
        return;
      }
      setErrors({ form: getErrorCode(err) === 'conflict' ? t('codeTaken') : te(`codes.${getErrorCode(err)}`) });
    },
  });

  const field = (k: keyof PromoDraft, label: string, props: React.ComponentProps<'input'> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`promo-${k}`} className="text-xs">
        {label}
      </Label>
      <Input id={`promo-${k}`} value={String(d[k])} onChange={(e) => set(k, e.target.value as never)} aria-invalid={errors[k] ? true : undefined} data-testid={`promo-field-${k}`} {...props} />
      {errors[k] ? <p className="text-xs text-destructive">{errors[k]}</p> : null}
    </div>
  );

  return (
    <Dialog open onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[90vh]">
        <DialogClose aria-label={t('cancel')} />
        <DialogHeader>
          <DialogTitle>{promotion ? t('promoEdit', { code: promotion.code }) : t('promoNew')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            save.mutate();
          }}
          data-testid="promo-form-admin"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {promotion ? null : field('code', t('code'), { className: 'uppercase', placeholder: 'SUMMER25' })}
            <div className="space-y-1">
              <Label htmlFor="promo-kind" className="text-xs">
                {t('kind')}
              </Label>
              <NativeSelect id="promo-kind" value={d.kind} onChange={(e) => set('kind', e.target.value as PromotionKind)} data-testid="promo-field-kind">
                {PROMOTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`promoKind.${k}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {field('value', t(`promoValue.${d.kind}`), { type: 'number', inputMode: 'numeric' })}
            {field('name_vi', t('nameVi'))}
            {field('name_en', t('nameEn'))}
            {field('valid_from', t('validFrom'), { type: 'datetime-local' })}
            {field('valid_to', t('validTo'), { type: 'datetime-local' })}
            {field('max_uses', t('maxUses'), { type: 'number', placeholder: '∞' })}
            {field('per_user_limit', t('perUserLimit'), { type: 'number' })}
            {field('plan_codes', t('planCodes'), { placeholder: 'toeic_pro_monthly, toeic_pro_yearly' })}
            {field('min_subtotal', t('minSubtotal'), { type: 'number' })}
            {d.kind === 'credit_bonus' ? field('credit_valid_days', t('creditValidDays'), { type: 'number', placeholder: '365' }) : null}
            {d.kind === 'trial_days' ? field('trial_plan_code', t('trialPlanCode'), { placeholder: 'toeic_pro_monthly' }) : null}
          </div>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">{t('programs')}</legend>
            <div className="flex flex-wrap gap-3">
              {PROGRAM_CODES.map((p) => (
                <label key={p} className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="size-4" checked={d.program_codes.includes(p)} onChange={() => toggle('program_codes', p)} />
                  {p.toUpperCase()}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium">{t('planKinds')}</legend>
            <div className="flex flex-wrap gap-3">
              {PLAN_KINDS.map((k) => (
                <label key={k} className="inline-flex items-center gap-1.5 text-sm">
                  <input type="checkbox" className="size-4" checked={d.plan_kinds.includes(k)} onChange={() => toggle('plan_kinds', k)} />
                  {k}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-5 text-sm">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" className="size-4" checked={d.new_users_only} onChange={(e) => set('new_users_only', e.target.checked)} />
              {t('newUsersOnly')}
            </label>
            {d.kind === 'credit_bonus' ? (
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={d.standalone} onChange={(e) => set('standalone', e.target.checked)} />
                {t('standalone')}
              </label>
            ) : null}
            <span className="inline-flex items-center gap-2">
              <Switch checked={d.is_active} onCheckedChange={(v) => set('is_active', v)} aria-label={t('active')} data-testid="promo-field-active" />
              {t('active')}
            </span>
          </div>
          {errors.form ? <p className="text-sm text-destructive">{errors.form}</p> : null}
          {Object.keys(errors).some((k) => !['form', 'code', 'value', 'valid_to', 'valid_from', 'max_uses', 'per_user_limit'].includes(k)) ? (
            <p className="text-sm text-destructive">{Object.entries(errors).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" variant="navy" disabled={save.isPending} data-testid="promo-save">
              {save.isPending ? <Spinner aria-hidden /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
