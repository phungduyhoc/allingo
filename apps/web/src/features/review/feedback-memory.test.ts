import { describe, expect, it } from 'vitest';
import { emptyFeedbackStore, explanationKey, parseFeedbackStore, readFeedback, writeFeedback } from './feedback-memory';

describe('feedback-memory – nhớ đánh giá theo ai_task_id', () => {
  const key = explanationKey('qv1', 'B', 'vi', 'pv1');

  it('khoá nội dung: thiếu phiên bản câu → null; chosen/prompt trống vẫn tạo khoá', () => {
    expect(key).toBe('qv1|B|vi|pv1');
    expect(explanationKey('qv1', undefined, 'vi', null)).toBe('qv1||vi|');
    expect(explanationKey(null, 'B', 'vi', 'pv1')).toBeNull();
  });

  it('đọc theo ai_task_id trước, rồi theo khoá nội dung (giải thích cache có ai_task_id mới/null)', () => {
    const s = writeFeedback(emptyFeedbackStore(), { ai_task_id: 't1', rating: 'helpful', at: 1 }, key);
    expect(readFeedback(s, 't1', null)?.rating).toBe('helpful');
    // Tải lại: Review trả giải thích cache với ai_task_id = null → vẫn thấy lựa chọn, kèm ai_task_id gốc để cập nhật
    expect(readFeedback(s, null, key)).toEqual({ ai_task_id: 't1', rating: 'helpful', at: 1 });
    expect(readFeedback(s, 't-new', key)?.ai_task_id).toBe('t1');
    expect(readFeedback(s, 'other', 'k-other')).toBeNull();
  });

  it('đổi đánh giá/ghi chú cập nhật cùng bản ghi; bất biến', () => {
    const a = writeFeedback(emptyFeedbackStore(), { ai_task_id: 't1', rating: 'helpful', at: 1 }, key);
    const b = writeFeedback(a, { ai_task_id: 't1', rating: 'wrong', comment: 'Sai đáp án', at: 2 }, key);
    expect(readFeedback(a, 't1', key)?.rating).toBe('helpful');
    expect(readFeedback(b, 't1', key)).toEqual({ ai_task_id: 't1', rating: 'wrong', comment: 'Sai đáp án', at: 2 });
  });

  it('giữ tối đa N bản ghi mới nhất và dọn khoá trỏ tới bản đã xoá', () => {
    let s = emptyFeedbackStore();
    for (let i = 0; i < 5; i++) s = writeFeedback(s, { ai_task_id: `t${i}`, rating: 'helpful', at: i }, `k${i}`, 3);
    expect(Object.keys(s.tasks).sort()).toEqual(['t2', 't3', 't4']);
    expect(Object.keys(s.keys).sort()).toEqual(['k2', 'k3', 'k4']);
  });

  it('parse: JSON hỏng → rỗng; bỏ bản ghi sai dạng và khoá mồ côi', () => {
    expect(parseFeedbackStore('{oops')).toEqual(emptyFeedbackStore());
    expect(parseFeedbackStore(null)).toEqual(emptyFeedbackStore());
    const raw = JSON.stringify({
      tasks: { t1: { ai_task_id: 't1', rating: 'not_helpful', at: 5, comment: 'x' }, t2: { ai_task_id: 't2', rating: 'meh', at: 1 }, t3: { ai_task_id: 'zz', rating: 'helpful' } },
      keys: { a: 't1', b: 't2', c: 42 },
    });
    expect(parseFeedbackStore(raw)).toEqual({ tasks: { t1: { ai_task_id: 't1', rating: 'not_helpful', at: 5, comment: 'x' } }, keys: { a: 't1' } });
  });
});
