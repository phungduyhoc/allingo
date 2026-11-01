import { describe, expect, it } from 'vitest';
import { allowedTargets, evaluateTransition } from '../src/lib/workflow';

describe('workflow – máy trạng thái câu hỏi', () => {
  it('editor gửi draft → review1 khi AI chưa fail; bị chặn khi verdict = fail', () => {
    expect(evaluateTransition({ from: 'draft', to: 'review1', role: 'editor', aiReport: { verdict: 'pass' } }).ok).toBe(true);
    expect(evaluateTransition({ from: 'ai_checked', to: 'review1', role: 'editor', aiReport: { verdict: 'needs_change' } }).ok).toBe(true);
    const blocked = evaluateTransition({ from: 'draft', to: 'review1', role: 'editor', aiReport: { verdict: 'fail' } });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toContain('fail');
  });

  it('draft → ai_checked chỉ qua nút AI với verdict pass/needs_change', () => {
    expect(evaluateTransition({ from: 'draft', to: 'ai_checked', role: 'editor', aiReport: { verdict: 'pass' } }).ok).toBe(false);
    const ok = evaluateTransition({ from: 'draft', to: 'ai_checked', role: 'editor', aiReport: { verdict: 'pass' }, viaAiCheck: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.effect.review).toEqual({ stage: 'ai_check', decision: 'approve' });
    expect(evaluateTransition({ from: 'draft', to: 'ai_checked', role: 'editor', aiReport: { verdict: 'fail' }, viaAiCheck: true }).ok).toBe(false);
  });

  it('editor không được duyệt review1 → review2; teacher/admin được và sinh bản ghi review', () => {
    const denied = evaluateTransition({ from: 'review1', to: 'review2', role: 'editor' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.message).toContain('editor');
    const ok = evaluateTransition({ from: 'review1', to: 'review2', role: 'teacher' });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.effect).toEqual({ review: { stage: 'review1', decision: 'approve' }, publish: false });
  });

  it('trả về draft từ review1/review2 bắt buộc có ghi chú', () => {
    expect(evaluateTransition({ from: 'review1', to: 'draft', role: 'teacher' }).ok).toBe(false);
    expect(evaluateTransition({ from: 'review2', to: 'draft', role: 'admin', note: 'Sửa lại đáp án B' }).ok).toBe(true);
  });

  it('review2 → published yêu cầu publish; published → retired; chuyển không hợp lệ báo tiếng Việt', () => {
    const pub = evaluateTransition({ from: 'review2', to: 'published', role: 'admin' });
    expect(pub.ok).toBe(true);
    if (pub.ok) expect(pub.effect.publish).toBe(true);
    expect(evaluateTransition({ from: 'published', to: 'retired', role: 'teacher' }).ok).toBe(true);
    const bad = evaluateTransition({ from: 'draft', to: 'published', role: 'admin' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/Không thể chuyển/);
    expect(evaluateTransition({ from: 'draft', to: 'draft', role: 'editor' }).ok).toBe(true);
  });

  it('allowedTargets liệt kê đúng theo vai trò', () => {
    expect(allowedTargets('review1', 'editor')).toEqual([]);
    expect(allowedTargets('review1', 'teacher')).toEqual(['review2', 'draft', 'rejected']);
    expect(allowedTargets('retired', 'teacher')).toEqual([]);
    expect(allowedTargets('retired', 'admin')).toEqual(['draft']);
  });
});
