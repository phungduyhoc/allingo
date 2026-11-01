import { describe, expect, it } from 'vitest';
import { parseReviewFilters, reviewApiQuery, reviewFiltersReducer, reviewFiltersToSearch, stepWrong, wrongIndices, wrongPosition } from './review-filters';

describe('review-filters', () => {
  it('URL ⇄ bộ lọc: giá trị lạ về mặc định, bỏ mặc định khi ghi', () => {
    expect(parseReviewFilters(new URLSearchParams('filter=wrong&section=part5'))).toEqual({ filter: 'wrong', section: 'part5' });
    expect(parseReviewFilters(new URLSearchParams('filter=hack&section=../x'))).toEqual({ filter: 'all', section: null });
    expect(parseReviewFilters(null)).toEqual({ filter: 'all', section: null });
    expect(reviewFiltersToSearch({ filter: 'all', section: null })).toBe('');
    expect(reviewFiltersToSearch({ filter: 'flagged', section: 'part7' })).toBe('filter=flagged&section=part7');
  });

  it('bộ lọc → tham số API kết hợp (only_wrong/flagged/section)', () => {
    expect(reviewApiQuery({ filter: 'all', section: null })).toEqual({});
    expect(reviewApiQuery({ filter: 'wrong', section: 'part6' })).toEqual({ only_wrong: true, section: 'part6' });
    expect(reviewApiQuery({ filter: 'flagged', section: null })).toEqual({ flagged: true });
  });

  it('reducer: đổi bộ lọc/Part độc lập, reset', () => {
    let s = reviewFiltersReducer({ filter: 'all', section: null }, { type: 'filter', filter: 'wrong' });
    s = reviewFiltersReducer(s, { type: 'section', section: 'part5' });
    expect(s).toEqual({ filter: 'wrong', section: 'part5' });
    expect(reviewFiltersReducer(s, { type: 'section', section: 'DROP TABLE' })).toEqual({ filter: 'wrong', section: null });
    expect(reviewFiltersReducer(s, { type: 'reset' })).toEqual({ filter: 'all', section: null });
  });

  it('điều hướng câu sai trước/tiếp theo, không quay vòng', () => {
    const items = [{ is_correct: true }, { is_correct: false }, { is_correct: null }, { is_correct: false }, { is_correct: false }];
    const wrong = wrongIndices(items);
    expect(wrong).toEqual([1, 3, 4]);
    expect(stepWrong(wrong, null, 1)).toBe(1);
    expect(stepWrong(wrong, null, -1)).toBe(4);
    expect(stepWrong(wrong, 1, 1)).toBe(3);
    expect(stepWrong(wrong, 2, 1)).toBe(3);
    expect(stepWrong(wrong, 4, 1)).toBeNull();
    expect(stepWrong(wrong, 3, -1)).toBe(1);
    expect(stepWrong(wrong, 1, -1)).toBeNull();
    expect(stepWrong([], null, 1)).toBeNull();
    expect(wrongPosition(wrong, 3)).toBe(2);
    expect(wrongPosition(wrong, null)).toBe(0);
  });
});
