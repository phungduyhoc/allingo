export const PRACTICE_SECTIONS = ['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'] as const;
export type PracticeSection = (typeof PRACTICE_SECTIONS)[number];

const CODE_RE = /^[a-z0-9_:-]{1,64}$/;
const isSection = (v: string | null): v is PracticeSection => !!v && (PRACTICE_SECTIONS as readonly string[]).includes(v);

export interface PracticePreset {
  section: PracticeSection | null;
  subskill: string | null;
  topic: string | null;
}

/** Tham số chọn sẵn từ URL (gợi ý luyện ở màn Kết quả): ?section=part5&subskill=verb_tense&topic=office – giá trị lạ bị bỏ */
export function practicePresetFrom(params: Pick<URLSearchParams, 'get'> | null | undefined): PracticePreset {
  const section = params?.get('section') ?? null;
  const subskill = params?.get('subskill') ?? null;
  const topic = params?.get('topic') ?? null;
  return {
    section: isSection(section) ? section : null,
    subskill: subskill && CODE_RE.test(subskill) ? subskill : null,
    topic: topic && CODE_RE.test(topic) ? topic : null,
  };
}
