import { z } from 'zod';

/**
 * Sinh đề mini ngẫu nhiên LẶP LẠI ĐƯỢC (Sprint 4): hàm thuần, PRNG có seed (mulberry32), không phụ thuộc thứ tự bản ghi DB.
 * - Câu cùng nhóm (passage/audio – Part 3/4/6/7) luôn được lấy trọn nhóm và liền nhau.
 * - Mỗi section dùng PRNG riêng dẫn xuất từ (seed, section_code): ngân hàng của một Part thay đổi không làm xáo trộn Part khác.
 * - Cùng (ngân hàng, blueprint, seed) → cùng danh sách câu, cùng thứ tự.
 * Kết quả luôn hợp lệ với `validateTestSetStructure('mini', …)` khi blueprint không vượt số câu chuẩn của section.
 */

/** PRNG mulberry32 (32 bit) – trả hàm sinh số thực [0, 1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Băm FNV-1a 32 bit (hex 8 ký tự) – dẫn xuất seed theo section và dấu vân tay ngân hàng câu */
export function fnv1a32(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const MINI_SEED_MAX = 2_147_483_647;

export const miniBlueprintSectionSchema = z.object({
  section_code: z.string().min(1).max(32),
  count: z.number().int().min(1).max(200),
  /** Kích thước nhóm cho phép (vd. Part 3/4 chỉ nhóm 3 câu); bỏ trống = mọi kích thước. Không áp cho câu đơn */
  group_sizes: z.array(z.number().int().min(1).max(10)).min(1).optional(),
  /** Bắt buộc có ≥ min nhóm với kích thước thuộc sizes (vd. Part 7 "1 bộ đôi" = nhóm 5 câu) */
  require_groups: z.array(z.object({ sizes: z.array(z.number().int().min(1).max(10)).min(1), min: z.number().int().min(1).max(20) })).max(5).optional(),
});
export const miniBlueprintSchema = z.object({
  code: z.string().min(1).max(64),
  sections: z.array(miniBlueprintSectionSchema).min(1).max(20),
});
export type MiniBlueprintSection = z.infer<typeof miniBlueprintSectionSchema>;
export type MiniBlueprint = z.infer<typeof miniBlueprintSchema>;

/**
 * Blueprint mặc định TOEIC L&R mini 60 câu: Listening 34 (P1 6 · P2 10 · P3 9 = 3 hội thoại · P4 9 = 3 bài nói),
 * Reading 26 (P5 10 · P6 4 = 1 đoạn · P7 12 gồm đoạn đơn + ≥ 1 bộ nhiều văn bản 5 câu). Mọi số ≤ số câu chuẩn của Part.
 */
export const TOEIC_MINI_BLUEPRINT_60: MiniBlueprint = {
  code: 'toeic_lr_mini_60_v1',
  sections: [
    { section_code: 'part1', count: 6 },
    { section_code: 'part2', count: 10 },
    { section_code: 'part3', count: 9, group_sizes: [3] },
    { section_code: 'part4', count: 9, group_sizes: [3] },
    { section_code: 'part5', count: 10 },
    { section_code: 'part6', count: 4, group_sizes: [4] },
    { section_code: 'part7', count: 12, require_groups: [{ sizes: [5], min: 1 }] },
  ],
};

export interface MiniBankItem {
  question_id: string;
  section_code: string;
  /** Khoá nhóm (passage_id/audio) – null = câu đơn */
  group_key: string | null;
  /** Thứ tự trong nhóm (số câu gốc); thiếu → theo question_id */
  order?: number | null;
}

export interface MiniTestItem {
  question_id: string;
  section_code: string;
  sort_order: number;
  group_key: string | null;
}

export interface MiniShortfall {
  section_code: string;
  requested: number;
  selected: number;
  reason: 'bank_too_small' | 'no_exact_combination' | 'requirement_unmet';
}

export interface MiniTestResult {
  seed: number;
  blueprint_code: string;
  items: MiniTestItem[];
  by_section: Record<string, number>;
  shortfall: MiniShortfall[];
  /** Dấu vân tay ngân hàng đã dùng (các section trong blueprint): cùng vân tay + seed → tạo lại được đúng đề */
  bank_fingerprint: string;
}

interface Unit {
  key: string;
  grouped: boolean;
  items: MiniBankItem[];
}

const byId = (a: MiniBankItem, b: MiniBankItem) => (a.question_id < b.question_id ? -1 : a.question_id > b.question_id ? 1 : 0);

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Chọn tập con các đơn vị (theo thứ tự đã xáo) có tổng kích thước = target; null nếu không có */
function exactSubset(sizes: number[], target: number): number[] | null {
  if (target === 0) return [];
  const failed = new Set<number>();
  const stride = target + 1;
  const dfs = (i: number, rem: number): number[] | null => {
    if (rem === 0) return [];
    if (i >= sizes.length) return null;
    const memo = i * stride + rem;
    if (failed.has(memo)) return null;
    const s = sizes[i]!;
    if (s <= rem) {
      const r = dfs(i + 1, rem - s);
      if (r) return [i, ...r];
    }
    const r = dfs(i + 1, rem);
    if (r) return r;
    failed.add(memo);
    return null;
  };
  return dfs(0, target);
}

/** Tổng lớn nhất ≤ target đạt được từ các kích thước (quy hoạch động) */
function bestReachable(sizes: number[], target: number): number {
  const reach = new Array<boolean>(target + 1).fill(false);
  reach[0] = true;
  for (const s of sizes) for (let t = target; t >= s; t--) if (reach[t - s]) reach[t] = true;
  for (let t = target; t >= 0; t--) if (reach[t]) return t;
  return 0;
}

/** Giới hạn số đơn vị đưa vào tìm kiếm tổ hợp (đã xáo ngẫu nhiên nên lấy phần đầu vẫn ngẫu nhiên) */
const SEARCH_POOL = 400;

function pickSection(units: Unit[], spec: MiniBlueprintSection, rng: () => number, shortfall: MiniShortfall[]): Unit[] {
  const allowed = units.filter((u) => !u.grouped || !spec.group_sizes || spec.group_sizes.includes(u.items.length));
  const shuffled = shuffle(allowed, rng);
  const chosen = new Set<number>();
  let used = 0;

  for (const req of spec.require_groups ?? []) {
    let got = 0;
    for (let i = 0; i < shuffled.length && got < req.min; i++) {
      const u = shuffled[i]!;
      if (chosen.has(i) || !u.grouped || !req.sizes.includes(u.items.length) || used + u.items.length > spec.count) continue;
      chosen.add(i);
      used += u.items.length;
      got++;
    }
    if (got < req.min) shortfall.push({ section_code: spec.section_code, requested: spec.count, selected: -1, reason: 'requirement_unmet' });
  }

  const restIdx = shuffled.map((_, i) => i).filter((i) => !chosen.has(i)).slice(0, SEARCH_POOL);
  const remaining = spec.count - used;
  let pick: number[] | null;
  if (restIdx.every((i) => shuffled[i]!.items.length === 1)) {
    pick = restIdx.slice(0, remaining).map((_, k) => k);
  } else {
    const sizes = restIdx.map((i) => shuffled[i]!.items.length);
    pick = exactSubset(sizes, remaining);
    if (!pick) pick = exactSubset(sizes, bestReachable(sizes, remaining)) ?? [];
  }
  for (const k of pick) {
    chosen.add(restIdx[k]!);
    used += shuffled[restIdx[k]!]!.items.length;
  }

  if (used < spec.count) {
    const bankSize = allowed.reduce((n, u) => n + u.items.length, 0);
    shortfall.push({ section_code: spec.section_code, requested: spec.count, selected: used, reason: bankSize < spec.count ? 'bank_too_small' : 'no_exact_combination' });
  }
  for (const s of shortfall) if (s.section_code === spec.section_code && s.selected === -1) s.selected = used;

  // Thứ tự trong section: nhóm nhỏ trước (TOEIC Part 7: đoạn đơn rồi bộ nhiều văn bản), giữ thứ tự xáo trong cùng kích thước
  return [...chosen]
    .sort((a, b) => a - b)
    .map((i) => shuffled[i]!)
    .sort((a, b) => a.items.length - b.items.length);
}

export function generateMiniTest(bank: readonly MiniBankItem[], blueprint: MiniBlueprint, seed: number): MiniTestResult {
  if (!Number.isInteger(seed) || seed < 0 || seed > MINI_SEED_MAX) throw new RangeError(`seed must be an integer in [0, ${MINI_SEED_MAX}]`);
  const sections = new Set(blueprint.sections.map((s) => s.section_code));
  // Chuẩn hoá ngân hàng: bỏ trùng question_id, sắp xếp ổn định → không phụ thuộc thứ tự truy vấn DB
  const unique = new Map<string, MiniBankItem>();
  for (const it of bank) if (sections.has(it.section_code) && !unique.has(it.question_id)) unique.set(it.question_id, it);
  const items = [...unique.values()].sort(byId);
  const fingerprint = fnv1a32(items.map((i) => `${i.section_code}|${i.group_key ?? ''}|${i.question_id}`).join('\n'));

  const out: MiniTestItem[] = [];
  const bySection: Record<string, number> = {};
  const shortfall: MiniShortfall[] = [];
  const done = new Set<string>();
  for (const spec of blueprint.sections) {
    if (done.has(spec.section_code)) continue;
    done.add(spec.section_code);
    const units = new Map<string, Unit>();
    for (const it of items) {
      if (it.section_code !== spec.section_code) continue;
      const key = it.group_key ? `g:${it.group_key}` : `q:${it.question_id}`;
      const u = units.get(key) ?? { key, grouped: !!it.group_key, items: [] };
      u.items.push(it);
      units.set(key, u);
    }
    const sorted = [...units.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    for (const u of sorted) u.items.sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || byId(a, b));
    const rng = mulberry32(parseInt(fnv1a32(`${seed}:${spec.section_code}`), 16));
    const picked = pickSection(sorted, spec, rng, shortfall);
    for (const u of picked) for (const it of u.items) out.push({ question_id: it.question_id, section_code: spec.section_code, sort_order: out.length + 1, group_key: it.group_key });
    bySection[spec.section_code] = picked.reduce((n, u) => n + u.items.length, 0);
  }
  return { seed, blueprint_code: blueprint.code, items: out, by_section: bySection, shortfall, bank_fingerprint: fingerprint };
}

/** Seed ngẫu nhiên khi admin không chỉ định (1 … 2^31−1) */
export function randomMiniSeed(rand: () => number = Math.random): number {
  return 1 + Math.floor(rand() * (MINI_SEED_MAX - 1));
}
