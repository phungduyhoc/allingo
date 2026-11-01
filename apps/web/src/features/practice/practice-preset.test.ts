import { describe, expect, it } from 'vitest';
import { practicePresetFrom } from './practice-preset';

describe('practicePresetFrom (gợi ý luyện → chọn sẵn Part)', () => {
  it('đọc section/subskill/topic hợp lệ, bỏ giá trị lạ', () => {
    expect(practicePresetFrom(new URLSearchParams('section=part6&subskill=verb_tense'))).toEqual({ section: 'part6', subskill: 'verb_tense', topic: null });
    expect(practicePresetFrom(new URLSearchParams('section=part9&topic=<script>'))).toEqual({ section: null, subskill: null, topic: null });
    expect(practicePresetFrom(null)).toEqual({ section: null, subskill: null, topic: null });
  });
});
