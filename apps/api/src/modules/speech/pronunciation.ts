import { paToIeltsBand } from '@allingo/scoring';
import type { PronunciationAssessment } from './speech-provider.js';

export interface PronunciationBand {
  /** pa_score = 0.5·accuracy + 0.25·fluency + 0.25·prosody (0–100) */
  paScore: number;
  /** Band Pronunciation IELTS ước tính (bảng tạm PoC, docs/spec/allingo-prompts.yaml#scoring_rules.ielts_pronunciation_from_pa) */
  band: number;
  /** true khi dịch vụ không trả prosody → dùng fluency thay thế (cần ghi chú trong báo cáo/feedback) */
  prosodyImputed: boolean;
}

/**
 * Ánh xạ Pronunciation Assessment → band IELTS (dùng chung cho PoC-P và grade_speaking_ielts ở S6).
 * Quy tắc nằm ở @allingo/scoring.paToIeltsBand – không nhân bản bảng ở đây.
 */
export function pronunciationBandFromPa(pa: Pick<PronunciationAssessment, 'accuracy' | 'fluency' | 'prosody'>): PronunciationBand {
  const prosodyImputed = pa.prosody === null;
  const r = paToIeltsBand({ accuracy: pa.accuracy, fluency: pa.fluency, prosody: pa.prosody ?? pa.fluency });
  return { paScore: r.pa_score, band: r.band, prosodyImputed };
}
