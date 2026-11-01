/**
 * PoC-P (GATE-1): Pronunciation Assessment qua SpeechProvider.assessPronunciation (Azure REST hoặc mock),
 * thống kê accuracy/fluency/prosody, ánh xạ PA → band (scoring_rules.ielts_pronunciation_from_pa), tương quan band giáo viên.
 * Chạy: pnpm --filter @allingo/api poc:p   (SPEECH_PROVIDER=mock → kiểm chứng harness; azure → cần AZURE_SPEECH_KEY/REGION)
 *
 * Biến môi trường (chỉ dùng cho script này):
 *   POC_P_MANIFEST                  JSONL (mặc định eval/poc/pronunciation/manifest.sample.jsonl) – định dạng manifest.schema.json
 *   POC_P_LIMIT                     giới hạn số ghi âm (0 = tất cả)
 *   POC_P_CONCURRENCY               số lời gọi song song (mặc định 2)
 *   POC_P_SYNTHESIZE_MISSING        1 = thiếu tệp audio thì sinh sine tổng hợp (mặc định 1 khi provider mock, 0 khi azure)
 *   POC_P_PRICE_PER_AUDIO_HOUR_USD  đơn giá Azure STT/PA theo giờ audio để ước tính chi phí/phút (mặc định 1.0 – xác nhận bảng giá)
 *   POC_P_OUT                       thư mục kết quả (mặc định eval/poc/pronunciation/results)
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { checkThresholds, histogram, mae, mapPool, mean, pearson, percentile, round, summarize, withinRate } from '../lib/stats.js';
import { envInt, printTable, readJsonl, thresholdsFor, writeResult } from '../lib/common.js';
import { loadEnv } from '../../../apps/api/src/config/env.js';
import { createSpeechProvider, ffmpeg, ffmpegConfigFromEnv, pronunciationBandFromPa, SpeechProviderError, type PronunciationAssessment } from '../../../apps/api/src/modules/speech/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
/** Ngưỡng PoC-P lấy từ ielts_speaking_v1 – chỉ các khoá áp dụng được cho một tiêu chí Pronunciation */
const APPLICABLE = ['criterion_mae_max', 'within_0_5_min', 'pearson_min'];
const MIN_RECORDINGS = 100;
const MIN_SPEAKERS = 10;

interface ManifestItem {
  id: string;
  speaker_id: string;
  audio_path: string;
  reference_text: string;
  locale?: string;
  cefr_level?: string | null;
  band_source: 'teacher' | 'assumed' | 'none';
  teacher_pron_bands?: Array<{ rater: string; band: number }>;
}

interface ItemResult {
  id: string;
  speaker_id: string;
  cefr_level: string | null;
  ok: boolean;
  synthetic: boolean;
  duration_ms: number | null;
  latency_ms: number | null;
  pa: Omit<PronunciationAssessment, 'words' | 'recognizedText'> | null;
  mispronounced: number | null;
  pa_score: number | null;
  band: number | null;
  prosody_imputed: boolean;
  teacher_band: number | null;
  flags: string[];
  error?: string;
}

function validate(v: ManifestItem, line: number): string[] {
  const e: string[] = [];
  if (!v.id) e.push('id');
  if (!v.speaker_id) e.push('speaker_id');
  if (!v.audio_path) e.push('audio_path');
  if (!v.reference_text || v.reference_text.length < 2) e.push('reference_text');
  if (!['teacher', 'assumed', 'none'].includes(v.band_source)) e.push('band_source');
  for (const b of v.teacher_pron_bands ?? []) if (typeof b.band !== 'number' || b.band < 0 || b.band > 9) e.push(`teacher_pron_bands.${b.rater}`);
  return e.map((x) => `dòng ${line}: thiếu/sai ${x}`);
}

async function main(): Promise<void> {
  process.env.LOG_LEVEL ??= 'warn';
  const env = loadEnv();
  const cfg = ffmpegConfigFromEnv(env);
  if (!ffmpeg.ffmpegAvailable(cfg)) throw new Error('Cần ffmpeg/ffprobe (FFMPEG_PATH/FFPROBE_PATH)');
  const provider = createSpeechProvider(env);
  const manifestPath = path.resolve(process.env.POC_P_MANIFEST ?? path.join(here, 'manifest.sample.jsonl'));
  const manifestDir = path.dirname(manifestPath);
  const limit = envInt('POC_P_LIMIT', 0, 0);
  const concurrency = envInt('POC_P_CONCURRENCY', 2, 1);
  const synthesizeMissing = (process.env.POC_P_SYNTHESIZE_MISSING ?? (provider.name === 'mock' ? '1' : '0')) === '1';
  const pricePerHour = Number(process.env.POC_P_PRICE_PER_AUDIO_HOUR_USD ?? 1.0);
  const outDir = path.resolve(process.env.POC_P_OUT ?? path.join(here, 'results'));

  const rows = readJsonl<ManifestItem>(manifestPath);
  const errors = rows.flatMap((r) => validate(r.value, r.line));
  if (errors.length) throw new Error(`Manifest không hợp lệ:\n  ${errors.join('\n  ')}`);
  const items = rows.map((r) => r.value).slice(0, limit || undefined);
  const { evalSet, thresholds } = thresholdsFor('grade_speaking_ielts');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'allingo-poc-p-'));

  const runOne = async (it: ManifestItem): Promise<ItemResult> => {
    const base: ItemResult = { id: it.id, speaker_id: it.speaker_id, cefr_level: it.cefr_level ?? null, ok: false, synthetic: false, duration_ms: null, latency_ms: null, pa: null, mispronounced: null, pa_score: null, band: null, prosody_imputed: false, teacher_band: null, flags: [] };
    const tb = (it.teacher_pron_bands ?? []).map((b) => b.band);
    base.teacher_band = it.band_source !== 'none' && tb.length ? mean(tb) : null;
    try {
      let src = path.isAbsolute(it.audio_path) ? it.audio_path : path.resolve(manifestDir, it.audio_path);
      if (!fs.existsSync(src)) {
        if (!synthesizeMissing) throw new Error('audio_missing');
        // Tệp tổng hợp: sine dài ≈ số từ × 400 ms (chỉ để chạy thử harness)
        const words = it.reference_text.split(/\s+/).filter(Boolean).length;
        const freq = 300 + (createHash('sha1').update(it.id).digest()[0]! % 200);
        src = path.join(tmp, `${it.id}.synthetic.wav`);
        await ffmpeg.generateTestMedia(cfg, { kind: 'sine', durationMs: Math.max(1500, words * 400), frequency: freq, format: 'wav' }, src);
        base.synthetic = true;
      }
      const head = Buffer.alloc(64);
      const fh = await fsp.open(src, 'r');
      await fh.read(head, 0, 64, 0);
      await fh.close();
      const sniff = ffmpeg.sniffMedia(head);
      if (!sniff || sniff.kind !== 'audio') throw new Error('unsupported_media');
      const wav = path.join(tmp, `${it.id}.16k.wav`);
      await ffmpeg.toAssessmentWav(cfg, src, sniff.demuxer, wav);
      const probe = await ffmpeg.probeMedia(cfg, wav, 'wav');
      base.duration_ms = probe.durationMs;
      if ((probe.durationMs ?? 0) > 30_000) base.flags.push('over_30s_rest_limit');
      const started = Date.now();
      const pa = await provider.assessPronunciation({ data: await fsp.readFile(wav), mime: 'audio/wav' }, it.reference_text, it.locale ?? 'en-US');
      base.latency_ms = Date.now() - started;
      const band = pronunciationBandFromPa(pa);
      const { words, recognizedText: _text, ...scores } = pa;
      return { ...base, ok: true, pa: scores, mispronounced: words.filter((w) => w.errorType !== 'None').length, pa_score: band.paScore, band: band.band, prosody_imputed: band.prosodyImputed };
    } catch (err) {
      const msg = err instanceof SpeechProviderError ? `${err.reason}: ${err.message}` : (err as Error).message;
      return { ...base, error: msg.slice(0, 300) };
    }
  };

  const results = await mapPool(items, concurrency, runOne);
  await fsp.rm(tmp, { recursive: true, force: true });

  const ok = results.filter((r) => r.ok);
  const num = (f: (r: ItemResult) => number | null | undefined) => ok.map(f).filter((x): x is number => typeof x === 'number');
  const withTeacher = ok.filter((r) => r.teacher_band !== null);
  const speakers = new Set(ok.map((r) => r.speaker_id)).size;
  const audioMin = num((r) => r.duration_ms).reduce((a, b) => a + b, 0) / 60_000;
  const costPerMin = provider.name === 'azure' ? pricePerHour / 60 : 0;
  const latencies = num((r) => r.latency_ms);
  const rtf = ok.filter((r) => r.latency_ms && r.duration_ms).map((r) => r.latency_ms! / r.duration_ms!);
  const metrics = {
    n_items: items.length,
    n_ok: ok.length,
    n_failed: results.length - ok.length,
    n_synthetic: results.filter((r) => r.synthetic).length,
    speakers,
    audio_minutes: round(audioMin, 2),
    n_with_teacher_band: withTeacher.length,
    criterion_mae: round(mae(withTeacher.map((r) => r.band), withTeacher.map((r) => r.teacher_band))),
    within_0_5: round(withinRate(withTeacher.map((r) => r.band), withTeacher.map((r) => r.teacher_band))),
    pearson: round(pearson(withTeacher.map((r) => r.band), withTeacher.map((r) => r.teacher_band))),
    pearson_pa_score: round(pearson(withTeacher.map((r) => r.pa_score), withTeacher.map((r) => r.teacher_band))),
    latency_p50_ms: round(percentile(latencies, 0.5), 0),
    latency_p95_ms: round(percentile(latencies, 0.95), 0),
    realtime_factor_p50: round(percentile(rtf, 0.5), 3),
    cost_per_min_usd: round(costPerMin, 5),
    cost_total_usd: round(costPerMin * audioMin, 4),
    prosody_imputed: ok.filter((r) => r.prosody_imputed).length,
  };
  const distributions = {
    accuracy: summarize(num((r) => r.pa?.accuracy)),
    fluency: summarize(num((r) => r.pa?.fluency)),
    prosody: summarize(num((r) => r.pa?.prosody)),
    completeness: summarize(num((r) => r.pa?.completeness)),
    pron_score: summarize(num((r) => r.pa?.pronScore)),
    pa_score: summarize(num((r) => r.pa_score)),
  };
  const byLevel = Object.fromEntries(
    [...new Set(ok.map((r) => r.cefr_level ?? 'unknown'))].sort().map((lvl) => {
      const g = ok.filter((r) => (r.cefr_level ?? 'unknown') === lvl);
      return [lvl, { n: g.length, pa_score_mean: round(mean(g.map((r) => r.pa_score!)), 1), band_mean: round(mean(g.map((r) => r.band!)), 2) }];
    }),
  );
  const checks = checkThresholds(metrics, thresholds, APPLICABLE);
  const dataIssues: string[] = [];
  if (ok.length < MIN_RECORDINGS) dataIssues.push(`chỉ ${ok.length}/${MIN_RECORDINGS} ghi âm`);
  if (speakers < MIN_SPEAKERS) dataIssues.push(`chỉ ${speakers}/${MIN_SPEAKERS} người nói`);
  if (results.some((r) => r.synthetic)) dataIssues.push('có tệp audio tổng hợp');
  if (items.some((i) => i.band_source !== 'teacher')) dataIssues.push('có band không phải của giáo viên');
  const verdict = provider.name === 'mock' ? 'mock_only' : dataIssues.length ? 'insufficient_data' : checks.every((c) => c.pass === true) ? 'go' : 'no_go';

  const report = {
    poc: 'PoC-P',
    provider: provider.name,
    generated_at: new Date().toISOString(),
    disclaimer: provider.name === 'mock' ? 'SPEECH_PROVIDER=mock: điểm PA giả lập xác định theo hash, audio tổng hợp – chỉ kiểm chứng harness, KHÔNG phải số liệu thật.' : dataIssues.length ? `Chưa đủ điều kiện kết luận: ${dataIssues.join('; ')}` : null,
    manifest: { path: path.relative(process.cwd(), manifestPath), n: items.length },
    mapping: 'scoring_rules.ielts_pronunciation_from_pa (pa_score = 0.5·accuracy + 0.25·fluency + 0.25·prosody) qua @allingo/scoring.paToIeltsBand',
    eval_set_reference: evalSet,
    thresholds: Object.fromEntries(Object.entries(thresholds).filter(([k]) => APPLICABLE.includes(k))),
    data_requirements: { min_recordings: MIN_RECORDINGS, min_speakers: MIN_SPEAKERS, issues: dataIssues },
    metrics,
    distributions,
    band_histogram: histogram(num((r) => r.band)),
    by_cefr_level: byLevel,
    checks,
    verdict,
    items: results,
  };
  const file = writeResult(outDir, report);
  printTable([{ provider: provider.name, n_ok: `${metrics.n_ok}/${metrics.n_items}`, speakers, acc_mean: distributions.accuracy.mean, flu_mean: distributions.fluency.mean, pro_mean: distributions.prosody.mean, mae: metrics.criterion_mae, within_0_5: metrics.within_0_5, pearson: metrics.pearson, p95_ms: metrics.latency_p95_ms, usd_per_min: metrics.cost_per_min_usd, verdict }]);
  if (report.disclaimer) process.stdout.write(`⚠ ${report.disclaimer}\n`);
  process.stdout.write(`✔ PoC-P: ${file}\n`);
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    process.stderr.write(`✘ PoC-P lỗi: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
