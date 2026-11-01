import { describe, expect, it } from 'vitest';
import { activeLineIndex, markEvidence, parseTranscript, speakerTone, transcriptLines } from './transcript-format';

const SEGMENTS = [
  { start_ms: 0, end_ms: 700, text: 'Number 7.', speaker: 'N' },
  { start_ms: 1400, end_ms: 4550, text: 'Where can I find more paper for the printer?', speaker: 'W1' },
  { start_ms: 5250, end_ms: 7350, text: '(A) Yes, I printed the report.', speaker: 'M1' },
  { start_ms: 8050, end_ms: null, text: '(B) In the cabinet next to the copier.', speaker: 'M1' },
  { start_ms: 11550, end_ms: 13300, text: '(C) About two hundred pages.', speaker: 'M1' },
];

describe('transcript-format', () => {
  it('parse an toàn: sai dạng / rỗng → null', () => {
    expect(parseTranscript(null)).toBeNull();
    expect(parseTranscript({ text: 1 })).toBeNull();
    expect(parseTranscript({ text: '  ', evidence: null, source: 'media' })).toBeNull();
    expect(parseTranscript({ text: 'Hi', evidence: null, source: 'passage', extra: true })?.text).toBe('Hi');
  });

  it('dòng từ segments (giữ mốc) hoặc từ văn bản "M: …"', () => {
    expect(transcriptLines({ text: '', segments: SEGMENTS })[1]).toEqual({ speaker: 'W1', text: 'Where can I find more paper for the printer?', startMs: 1400, endMs: 4550 });
    const lines = transcriptLines({ text: "W: Hi, Daniel.\nM: Oh no.\n\nQuestions 32 through 34 refer to the following conversation.\nW1: Fine" });
    expect(lines.map((l) => l.speaker)).toEqual(['W', 'M', null, 'W1']);
    expect(lines[1]!.text).toBe('Oh no.');
    expect(lines[0]!.startMs).toBeNull();
  });

  it('dòng đang phát theo vị trí; khoảng lặng giữ dòng trước; thiếu end → tới dòng kế', () => {
    const lines = transcriptLines({ text: '', segments: SEGMENTS });
    expect(activeLineIndex(lines, null)).toBe(-1);
    expect(activeLineIndex(lines, 300)).toBe(0);
    expect(activeLineIndex(lines, 1000)).toBe(0);
    expect(activeLineIndex(lines, 2000)).toBe(1);
    expect(activeLineIndex(lines, 9000)).toBe(3);
    expect(activeLineIndex(lines, 11000)).toBe(3);
    expect(activeLineIndex(lines, 12000)).toBe(4);
    expect(activeLineIndex(lines, 13500)).toBe(4);
    expect(activeLineIndex(lines, 20000)).toBe(-1);
  });

  it('nhãn người nói → tông màu', () => {
    expect(speakerTone('M1')).toBe('man');
    expect(speakerTone('W')).toBe('woman');
    expect(speakerTone('N')).toBe('narrator');
    expect(speakerTone('Narrator')).toBe('narrator');
    expect(speakerTone(null)).toBe('other');
  });

  it('tô evidence không phân biệt hoa thường, nhiều lần, không chồng nhau', () => {
    expect(markEvidence('(B) In the cabinet next to the copier.', ['in the cabinet next to the copier'])).toEqual([
      { text: '(B) ', mark: false },
      { text: 'In the cabinet next to the copier', mark: true },
      { text: '.', mark: false },
    ]);
    expect(markEvidence('No match here', ['cabinet', null, ''])).toEqual([{ text: 'No match here', mark: false }]);
    const parts = markEvidence('room 4 is free; room 4 is fine', ['room 4', 'room 4 is free']);
    expect(parts.filter((p) => p.mark).map((p) => p.text)).toEqual(['room 4 is free', 'room 4']);
  });
});
