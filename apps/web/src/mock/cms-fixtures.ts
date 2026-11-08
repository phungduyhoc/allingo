import type { CmsPage, CmsPost, LexicalNode, LexicalRoot } from '@/lib/cms/types';

/**
 * Fixture CMS marketing (S10) cho dev/e2e chạy API giả lập khi Payload không chạy – nội dung TỰ BIÊN SOẠN (CLAUDE.md §10), cùng
 * dạng REST công khai của apps/cms (pages blocks, posts Lexical song ngữ, category, authors). Không dùng ở production.
 */

const text = (t: string, format = 0): LexicalNode => ({ type: 'text', text: t, format, version: 1 });
const p = (...children: LexicalNode[]): LexicalNode => ({ type: 'paragraph', children, version: 1 });
const h2 = (t: string): LexicalNode => ({ type: 'heading', tag: 'h2', children: [text(t)], version: 1 });
const ul = (...items: string[]): LexicalNode => ({ type: 'list', listType: 'bullet', tag: 'ul', children: items.map((i) => ({ type: 'listitem', children: [text(i)], version: 1 })), version: 1 });
const link = (label: string, url: string): LexicalNode => ({ type: 'link', fields: { url, linkType: 'custom' }, children: [text(label)], version: 1 });
const doc = (...children: LexicalNode[]): LexicalRoot => ({ root: { type: 'root', children, version: 1 } });

const CATEGORY = { id: '00000000-0000-4000-8000-0000000c0001', slug: 'meo-toeic', name: { vi: 'Mẹo TOEIC', en: 'TOEIC tips' }, description: { vi: 'Mẹo làm bài theo từng Part.', en: 'Part-by-part tips.' } };
const GUIDE = { id: '00000000-0000-4000-8000-0000000c0002', slug: 'huong-dan', name: { vi: 'Hướng dẫn Allingo', en: 'Using Allingo' }, description: null };
const AUTHOR = { id: '00000000-0000-4000-8000-0000000a0001', slug: 'ban-bien-tap', name: 'Ban biên tập Allingo', bio: { vi: 'Nhóm biên soạn nội dung luyện thi.', en: 'The test-prep content team.' }, avatar: null };

export const CMS_FIXTURE_POSTS: CmsPost[] = [
  {
    id: '00000000-0000-4000-8000-0000000b0001',
    slug: 'meo-toeic-part-5',
    title: { vi: '5 mẹo làm Part 5 TOEIC nhanh và chắc', en: '5 tips for a faster, steadier TOEIC Part 5' },
    excerpt: { vi: 'Nhìn từ quanh chỗ trống trước khi đọc nghĩa – cách tiết kiệm 3–4 phút cho Part 7.', en: 'Read the words around the blank before the meaning – save 3–4 minutes for Part 7.' },
    content: {
      vi: doc(
        p(text('Part 5 có 30 câu hoàn thành câu. Mục tiêu là '), text('dưới 20 giây mỗi câu', 1), text(' để dành thời gian cho đọc hiểu.')),
        h2('1. Xác định loại câu trước'),
        p(text('Nếu bốn lựa chọn là các dạng của cùng một từ, đây là câu từ loại: chỉ cần nhìn từ đứng trước và sau chỗ trống.')),
        h2('2. Ghi nhớ các tín hiệu thì'),
        ul('by + mốc thời gian → hoàn thành/tương lai', 'since/for → hiện tại hoàn thành', 'yesterday/last week → quá khứ đơn'),
        h2('3. Ôn lại câu sai'),
        p(text('Mỗi câu sai được lưu vào sổ lỗi. Xem thêm '), link('hướng dẫn dùng Allingo', '/blog/cach-dung-allingo'), text('.')),
      ),
      en: doc(p(text('Part 5 has 30 sentence-completion items. Aim for '), text('under 20 seconds each', 1), text(' to save time for reading.')), h2('1. Identify the item type first'), p(text('If the four options are forms of one word, look only at the words before and after the blank.'))),
    },
    coverImage: null,
    category: CATEGORY,
    authors: [AUTHOR],
    program: 'toeic',
    publishedAt: '2026-11-02T01:00:00.000Z',
    updatedAt: '2026-11-02T05:00:00.000Z',
    readingMinutes: 4,
    schemaType: 'BlogPosting',
    faq: [{ question: { vi: 'Part 5 có bao nhiêu câu?', en: 'How many items are in Part 5?' }, answer: { vi: '30 câu hoàn thành câu.', en: '30 sentence-completion items.' } }],
    seo: { title: { vi: 'Mẹo Part 5 TOEIC | Allingo', en: 'TOEIC Part 5 tips | Allingo' }, description: { vi: 'Năm mẹo làm Part 5 TOEIC nhanh: từ loại, tín hiệu thì, ôn câu sai.', en: 'Five quick TOEIC Part 5 tips: word forms, tense signals, reviewing mistakes.' }, ogImage: null, canonical: null, noindex: false },
  },
  {
    id: '00000000-0000-4000-8000-0000000b0002',
    slug: 'lo-trinh-30-ngay-toeic',
    title: { vi: 'Lộ trình 30 ngày luyện TOEIC cho người bận rộn', en: 'A 30-day TOEIC plan for busy learners' },
    excerpt: { vi: '45 phút mỗi ngày, chia theo tuần: nền tảng → luyện Part yếu → đề thi thử.', en: '45 minutes a day, week by week: foundations → weak parts → mock tests.' },
    content: { vi: doc(p(text('Lộ trình chia thành ba chặng.')), h2('Tuần 1–2: nền tảng'), p(text('Ôn từ vựng mỗi ngày và luyện Part 5.')), h2('Tuần 3–4: mô phỏng'), p(text('Làm đề mini và một đề full mỗi tuần.'))), en: null },
    coverImage: null,
    category: GUIDE,
    authors: [AUTHOR],
    program: 'toeic',
    publishedAt: '2026-11-01T02:00:00.000Z',
    updatedAt: '2026-11-01T02:00:00.000Z',
    readingMinutes: 3,
    schemaType: 'Article',
    faq: [],
    seo: null,
  },
  {
    id: '00000000-0000-4000-8000-0000000b0003',
    slug: 'cach-dung-allingo',
    title: { vi: 'Cách dùng Allingo mỗi ngày', en: 'How to use Allingo every day' },
    excerpt: { vi: 'Chẩn đoán, Hôm nay, giải thích AI, sổ lỗi và ôn thẻ từ vựng.', en: 'Diagnostic, Today, AI explanations, the error log and flashcards.' },
    content: { vi: doc(p(text('Bắt đầu bằng bài chẩn đoán rồi mở "Hôm nay" mỗi ngày.')), ul('Ôn thẻ từ đến hạn', 'Làm lại 10 câu sai', 'Xem thống kê tuần')), en: doc(p(text('Start with the diagnostic, then open "Today" every day.'))) },
    coverImage: null,
    category: GUIDE,
    authors: [AUTHOR],
    program: 'general',
    publishedAt: '2026-10-30T03:00:00.000Z',
    updatedAt: '2026-10-30T03:00:00.000Z',
    readingMinutes: 2,
    schemaType: 'BlogPosting',
    faq: [],
    seo: null,
  },
];

const faqItems = [
  { question: { vi: 'Allingo có miễn phí không?', en: 'Is Allingo free?' }, answer: { vi: 'Có gói Free với hạn mức hằng ngày; Pro mở rộng hạn mức và đề thi thử.', en: 'Yes, Free has daily limits; Pro raises them and adds mock tests.' } },
  { question: { vi: 'Điểm trên Allingo có phải điểm chính thức?', en: 'Are Allingo scores official?' }, answer: { vi: 'Không. Điểm quy đổi và dự báo là ước tính để theo dõi tiến bộ.', en: 'No. Scaled scores and forecasts are estimates to track progress.' } },
];

export const CMS_FIXTURE_PAGES: CmsPage[] = [
  {
    id: '00000000-0000-4000-8000-0000000d0001',
    slug: 'home',
    title: { vi: 'Allingo – Luyện thi ngoại ngữ cùng AI', en: 'Allingo – AI test prep' },
    layout: [
      { blockType: 'hero', eyebrow: { vi: 'Ngoại ngữ cho tất cả', en: 'Languages for everyone' }, heading: { vi: 'Luyện thi đúng định dạng, có AI giải thích từng câu', en: 'Exam-format practice with AI explanations' }, subheading: { vi: 'Bài chẩn đoán miễn phí, lộ trình theo ngày thi và ôn tập mỗi ngày.', en: 'A free diagnostic, a plan for your exam date and daily review.' }, primaryCta: { label: { vi: 'Làm bài chẩn đoán', en: 'Take the diagnostic' }, href: '/register?next=/diagnostic' }, secondaryCta: { label: { vi: 'Xem bảng giá', en: 'See pricing' }, href: '/pricing' } },
      { blockType: 'features', heading: { vi: 'Mọi thứ để lên điểm', en: 'Everything to raise your score' }, items: [{ icon: 'file-check', title: { vi: 'Đề đúng định dạng', en: 'Exam format' }, body: { vi: 'Đề full, mini và luyện theo Part.', en: 'Full, mini tests and part drills.' } }, { icon: 'sparkles', title: { vi: 'Giải thích AI', en: 'AI explanations' }, body: { vi: 'Vì sao đúng, vì sao sai.', en: 'Why right, why wrong.' } }, { icon: 'layers', title: { vi: 'Từ vựng FSRS', en: 'FSRS vocabulary' }, body: { vi: 'Ôn đúng lúc sắp quên.', en: 'Review right before you forget.' } }] },
      { blockType: 'pricing', heading: { vi: 'Bắt đầu miễn phí', en: 'Start free' }, note: { vi: 'Thanh toán VNPay, MoMo, ZaloPay.', en: 'Pay with VNPay, MoMo or ZaloPay.' }, program: 'toeic', highlightPlanCode: null },
      { blockType: 'faq', heading: { vi: 'Câu hỏi thường gặp', en: 'FAQ' }, items: faqItems },
      { blockType: 'cta', heading: { vi: 'Sẵn sàng bắt đầu?', en: 'Ready to start?' }, body: { vi: 'Khoảng 25 phút để biết bạn đang ở đâu.', en: 'About 25 minutes to see where you stand.' }, button: { label: { vi: 'Tạo tài khoản miễn phí', en: 'Create a free account' }, href: '/register' } },
    ],
    seo: { title: { vi: 'Allingo – Luyện thi TOEIC, IELTS, JLPT, HSK cùng AI', en: 'Allingo – AI prep for TOEIC, IELTS, JLPT, HSK' }, description: { vi: 'Làm đề đúng định dạng, giải thích AI song ngữ, lộ trình đến ngày thi, sổ lỗi và ôn từ vựng FSRS.', en: 'Exam-format practice, bilingual AI explanations, a plan to exam day, an error log and FSRS reviews.' }, ogImage: null, canonical: null, noindex: false },
  },
  {
    id: '00000000-0000-4000-8000-0000000d0002',
    slug: 'toeic',
    title: { vi: 'Luyện thi TOEIC Listening & Reading', en: 'TOEIC Listening & Reading prep' },
    layout: [
      { blockType: 'hero', eyebrow: { vi: 'TOEIC Listening & Reading', en: 'TOEIC Listening & Reading' }, heading: { vi: 'Luyện TOEIC đúng định dạng, biết rõ mình sai ở đâu', en: 'Practise TOEIC in the real format' }, subheading: { vi: '7 Part, 200 câu, 120 phút – luyện từng Part hoặc làm đề full.', en: '7 parts, 200 items, 120 minutes.' }, primaryCta: { label: { vi: 'Làm bài chẩn đoán TOEIC', en: 'Take the TOEIC diagnostic' }, href: '/register?next=/diagnostic' }, secondaryCta: { label: { vi: 'Đọc mẹo Part 5', en: 'Read Part 5 tips' }, href: '/blog/meo-toeic-part-5' } },
      { blockType: 'features', heading: { vi: 'Luyện theo từng Part', en: 'Part by part' }, items: [{ icon: 'headphones', title: { vi: 'Part 1–4', en: 'Parts 1–4' }, body: { vi: 'Nghe một lần như thi thật.', en: 'Played once like the real test.' } }, { icon: 'book-open', title: { vi: 'Part 5–7', en: 'Parts 5–7' }, body: { vi: 'Ngữ pháp, từ vựng, đọc hiểu có giới hạn giờ.', en: 'Grammar, vocabulary, timed reading.' } }] },
      { blockType: 'testimonial', heading: { vi: 'Người học nói gì', en: 'What learners say' }, items: [{ quote: { vi: 'Sổ lỗi giúp mình thấy rõ mình hay sai bẫy Part 2.', en: 'The error log showed me my Part 2 traps.' }, name: 'Học viên beta', role: { vi: 'Mục tiêu 750', en: 'Target 750' }, consent: true }] },
      { blockType: 'faq', heading: { vi: 'Hỏi đáp TOEIC', en: 'TOEIC FAQ' }, items: [{ question: { vi: 'Đề trên Allingo có phải đề thi thật?', en: 'Are these real TOEIC tests?' }, answer: { vi: 'Không. Câu hỏi do Allingo tự biên soạn theo đúng định dạng đề.', en: 'No. All items are written by Allingo in the official format.' } }] },
      { blockType: 'cta', heading: { vi: 'Biết điểm TOEIC ước tính trong 25 phút', en: 'Your estimated TOEIC score in 25 minutes' }, body: null, button: { label: { vi: 'Bắt đầu miễn phí', en: 'Start free' }, href: '/register?next=/diagnostic' } },
    ],
    seo: { title: { vi: 'Luyện thi TOEIC online cùng AI | Allingo', en: 'Online TOEIC prep with AI | Allingo' }, description: { vi: 'Đề TOEIC đúng định dạng 7 Part, chế độ thi thật, giải thích AI song ngữ, sổ lỗi và lộ trình theo mục tiêu.', en: 'TOEIC practice in the real 7-part format with bilingual AI explanations.' }, ogImage: null, canonical: null, noindex: false },
  },
];
