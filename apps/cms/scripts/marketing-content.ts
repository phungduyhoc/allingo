/**
 * Nội dung marketing TỰ VIẾT cho seed Sprint 10 (không sao chép đề/tài liệu ETS; ví dụ câu do Allingo soạn).
 * 3 bài blog (vi + en) và 2 trang dạng blocks: trang chủ `/` (slug home) và `/toeic`.
 * Không có testimonial: chỉ đăng cảm nhận THẬT của người học đã đồng ý công khai (field consent) – A163.
 */
import type { LexicalBlock } from '../src/lib/lexical';

export interface SeedPost {
  slug: string;
  category: string;
  title: { vi: string; en: string };
  excerpt: { vi: string; en: string };
  content: { vi: LexicalBlock[]; en: LexicalBlock[] };
  faq?: Array<{ question: { vi: string; en: string }; answer: { vi: string; en: string } }>;
  seo: { title: { vi: string; en: string }; description: { vi: string; en: string } };
  publishedAt: string;
}

export const SEED_CATEGORIES = [
  { slug: 'meo-toeic', name: { vi: 'Mẹo TOEIC', en: 'TOEIC tips' }, description: { vi: 'Chiến thuật làm từng Part của TOEIC Listening & Reading.', en: 'Strategies for each TOEIC Listening & Reading part.' } },
  { slug: 'lo-trinh', name: { vi: 'Lộ trình học', en: 'Study plans' }, description: { vi: 'Kế hoạch học theo tuần, theo mục tiêu điểm.', en: 'Week-by-week plans for your target score.' } },
  { slug: 'huong-dan', name: { vi: 'Hướng dẫn Allingo', en: 'Using Allingo' }, description: { vi: 'Cách dùng các tính năng của Allingo.', en: 'How to use Allingo features.' } },
] as const;

export const SEED_AUTHOR = { slug: 'ban-bien-tap', name: 'Ban biên tập Allingo', bio: { vi: 'Nhóm biên soạn nội dung luyện thi của Allingo.', en: 'The Allingo test-prep content team.' } };

export const SEED_POSTS: SeedPost[] = [
  {
    slug: 'meo-toeic-part-5',
    category: 'meo-toeic',
    publishedAt: '2026-11-02T01:00:00.000Z',
    title: { vi: '5 mẹo làm TOEIC Part 5 nhanh và chính xác', en: '5 tips to finish TOEIC Part 5 fast and accurately' },
    excerpt: {
      vi: 'Part 5 (điền vào câu) là phần gỡ điểm và tiết kiệm thời gian cho Part 7. Năm thói quen dưới đây giúp bạn làm mỗi câu trong khoảng 20–25 giây.',
      en: 'Part 5 (incomplete sentences) is where you win back time for Part 7. These five habits help you answer each item in about 20–25 seconds.',
    },
    seo: {
      title: { vi: '5 mẹo làm TOEIC Part 5 nhanh, chính xác | Allingo', en: '5 TOEIC Part 5 tips: faster and more accurate | Allingo' },
      description: { vi: 'Nhận diện loại câu, từ loại, thì, collocation và quản lý thời gian 20–25 giây/câu cho TOEIC Part 5.', en: 'Spot the question type, word forms, tenses and collocations, and keep each Part 5 item to 20–25 seconds.' },
    },
    content: {
      vi: [
        { p: 'Part 5 gồm các câu chưa hoàn chỉnh với bốn lựa chọn. Điểm mấu chốt không phải là học thật nhiều mẹo, mà là **nhận ra câu đang hỏi gì trong vài giây đầu** rồi chỉ đọc phần cần thiết.' },
        { h2: '1. Nhìn bốn đáp án trước khi đọc câu' },
        { p: 'Bốn đáp án cho biết loại câu: cùng gốc từ khác đuôi (-tion, -tive, -ly) là câu **từ loại**; cùng động từ khác thì là câu **thì/dạng động từ**; bốn từ khác nghĩa là câu **từ vựng**; at/in/on/by là câu **giới từ**. Biết loại câu, bạn biết phải tìm manh mối ở đâu.' },
        { h2: '2. Câu từ loại: xác định vị trí chỗ trống' },
        { ul: ['Trước danh từ, sau mạo từ → thường là **tính từ** (a **reliable** supplier).', 'Sau động từ to be và trước giới từ → có thể là tính từ (is **responsible** for).', 'Bổ nghĩa cho động từ hoặc cả câu → **trạng từ** (was **quickly** approved).', 'Sau giới từ hoặc làm chủ ngữ → **danh từ / V-ing**.'] },
        { h2: '3. Câu thì: tìm trạng từ chỉ thời gian' },
        { p: 'Những tín hiệu như **since, for the past two years** gợi ý hiện tại hoàn thành; **by the time, by next Friday** gợi ý tương lai hoàn thành; **yesterday, last quarter** là quá khứ đơn. Ví dụ: "The team ___ three new clients since January." → **has signed**.' },
        { h2: '4. Câu từ vựng: đọc trọn câu và chú ý collocation' },
        { p: 'Với câu từ vựng, đừng chọn từ "nghe quen". Hãy đọc trọn câu và kiểm tra cụm đi kèm: **meet a deadline**, **submit a proposal**, **reach an agreement**. Ôn các cụm này bằng thẻ từ vựng mỗi ngày hiệu quả hơn học danh sách dài một lần.' },
        { h2: '5. Giữ nhịp 20–25 giây mỗi câu' },
        { p: 'Nếu một câu đã quá 40 giây, hãy chọn đáp án hợp lý nhất, đánh dấu và đi tiếp. Thời gian dành cho Part 7 quan trọng hơn một câu Part 5. Trong Allingo, câu làm quá lâu được ghi vào sổ lỗi với nhãn **timeout** để bạn luyện tốc độ riêng.' },
        { h2: 'Luyện ngay' },
        { p: 'Làm một lượt luyện Part 5 có giới hạn giờ, sau đó mở sổ lỗi để xem các câu sai được phân loại (ngữ pháp, từ vựng, quá thời gian) và bấm "Làm lại 10 câu sai".' },
      ],
      en: [
        { p: 'Part 5 gives you incomplete sentences with four options. The key is not memorising dozens of tricks but **recognising what the item is testing within the first few seconds**, then reading only what you need.' },
        { h2: '1. Look at the four options first' },
        { p: 'The options reveal the item type: same root with different endings is a **word-form** item; the same verb in different tenses is a **tense/verb-form** item; four unrelated words is a **vocabulary** item; at/in/on/by is a **preposition** item.' },
        { h2: '2. Word form: locate the blank' },
        { ul: ['Before a noun, after an article → usually an **adjective** (a **reliable** supplier).', 'After "be" and before a preposition → often an adjective (is **responsible** for).', 'Modifying a verb or clause → an **adverb** (was **quickly** approved).', 'After a preposition or as a subject → a **noun / -ing form**.'] },
        { h2: '3. Tense: find the time expression' },
        { p: '**Since** or **for the past two years** points to the present perfect; **by the time** or **by next Friday** to the future perfect; **yesterday** or **last quarter** to the past simple. Example: "The team ___ three new clients since January." → **has signed**.' },
        { h2: '4. Vocabulary: read the whole sentence and check collocations' },
        { p: 'Do not pick the word that merely sounds familiar. Check what it combines with: **meet a deadline**, **submit a proposal**, **reach an agreement**. Short daily flashcard reviews beat one long list.' },
        { h2: '5. Keep a 20–25 second pace' },
        { p: 'If an item has taken more than 40 seconds, choose the most likely option, flag it and move on. Part 7 time matters more. In Allingo, slow items are logged in your error log as **timeout** so you can train speed separately.' },
      ],
    },
    faq: [
      { question: { vi: 'TOEIC Part 5 có bao nhiêu câu?', en: 'How many items are in TOEIC Part 5?' }, answer: { vi: 'Part 5 có 30 câu điền vào câu chưa hoàn chỉnh, nằm trong phần Reading 75 phút.', en: 'Part 5 has 30 incomplete-sentence items within the 75-minute Reading section.' } },
      { question: { vi: 'Nên dành bao lâu cho mỗi câu Part 5?', en: 'How long should I spend per Part 5 item?' }, answer: { vi: 'Khoảng 20–25 giây; quá 40 giây thì chọn đáp án hợp lý nhất và đi tiếp.', en: 'About 20–25 seconds; after 40 seconds, pick the most likely option and move on.' } },
    ],
  },
  {
    slug: 'lo-trinh-30-ngay-toeic',
    category: 'lo-trinh',
    publishedAt: '2026-11-02T02:00:00.000Z',
    title: { vi: 'Lộ trình 30 ngày luyện TOEIC cho người mới bắt đầu', en: 'A 30-day TOEIC plan for beginners' },
    excerpt: {
      vi: 'Bốn tuần, mỗi ngày 45–60 phút: nền tảng → Listening → Reading → mô phỏng. Kèm cách đo tiến bộ bằng bài chẩn đoán và đề thi thử.',
      en: 'Four weeks, 45–60 minutes a day: foundations → Listening → Reading → simulation, with a diagnostic and a mock test to measure progress.',
    },
    seo: {
      title: { vi: 'Lộ trình 30 ngày luyện TOEIC cho người mới | Allingo', en: '30-day TOEIC study plan for beginners | Allingo' },
      description: { vi: 'Kế hoạch 4 tuần luyện TOEIC Listening & Reading: từ vựng hằng ngày, luyện theo Part, sổ lỗi và một đề thi thử cuối tháng.', en: 'A 4-week TOEIC Listening & Reading plan: daily vocabulary, part-by-part practice, an error log and a final mock test.' },
    },
    content: {
      vi: [
        { p: 'Lộ trình dưới đây dành cho người mới hoặc đang ở mức 300–450 điểm, học **45–60 phút mỗi ngày, 6 ngày/tuần**. Mục tiêu sau 30 ngày: quen định dạng đề, có thói quen ôn từ vựng và biết rõ điểm yếu của mình.' },
        { h2: 'Ngày 1: đo điểm xuất phát' },
        { p: 'Làm bài chẩn đoán khoảng 25–30 phút để biết điểm ước tính và các kỹ năng yếu. Đặt mục tiêu điểm và ngày thi – lộ trình sẽ chia thời gian theo đó.' },
        { h2: 'Tuần 1 – Nền tảng' },
        { ul: ['Mỗi ngày học **10 từ mới** và ôn các thẻ đến hạn (khoảng 10 phút).', 'Part 1–2: luyện nghe mô tả tranh và hỏi–đáp ngắn, chú ý từ phát âm giống nhau.', 'Part 5: ôn từ loại và các thì cơ bản.'] },
        { h2: 'Tuần 2 – Listening' },
        { ul: ['Part 3–4: đọc câu hỏi trước khi nghe, đoán nội dung hội thoại.', 'Nghe lại đoạn mình sai cùng transcript, ghi chú cụm diễn đạt lại (paraphrase).', 'Cuối tuần: điểm danh và điều chỉnh khối lượng tuần sau.'] },
        { h2: 'Tuần 3 – Reading' },
        { ul: ['Part 6: đọc cả đoạn để chọn câu chèn phù hợp ngữ cảnh.', 'Part 7: luyện tìm thông tin (scanning) trước, suy luận sau.', 'Luyện có giới hạn giờ để quen áp lực thời gian.'] },
        { h2: 'Tuần 4 – Mô phỏng' },
        { ul: ['Làm **một đề thi thử đầy đủ** trong 2 giờ ở chế độ thi thật.', 'Mở sổ lỗi, làm lại 10 câu sai cũ nhất mỗi ngày.', 'So điểm với bài chẩn đoán đầu tháng và xem dự báo (ước tính sơ bộ) tới ngày thi.'] },
        { h2: 'Nếu bị lỡ lịch' },
        { p: 'Đừng cố bù hết trong một ngày. Ưu tiên ôn từ vựng đến hạn và một lượt luyện ngắn của Part yếu nhất; phần còn lại để lộ trình tự sắp xếp lại vào tuần sau.' },
      ],
      en: [
        { p: 'This plan is for beginners or learners around 300–450 points studying **45–60 minutes a day, six days a week**. After 30 days you should know the test format, review vocabulary daily and understand your weak spots.' },
        { h2: 'Day 1: measure your starting point' },
        { p: 'Take a 25–30 minute diagnostic to get an estimated score and your weakest skills. Set a target score and exam date so the plan can split your time.' },
        { h2: 'Week 1 – Foundations' },
        { ul: ['Learn **10 new words** a day and review due cards (about 10 minutes).', 'Parts 1–2: photos and short question–response items; watch for similar-sounding words.', 'Part 5: word forms and basic tenses.'] },
        { h2: 'Week 2 – Listening' },
        { ul: ['Parts 3–4: read the questions before the audio and predict the topic.', 'Replay what you missed with the transcript and note paraphrases.', 'Weekend: check in and adjust next week’s workload.'] },
        { h2: 'Week 3 – Reading' },
        { ul: ['Part 6: read the whole passage to choose the sentence that fits.', 'Part 7: scan for facts first, inference questions second.', 'Practise with a timer to get used to pressure.'] },
        { h2: 'Week 4 – Simulation' },
        { ul: ['Take **one full mock test** in two hours in exam mode.', 'Open your error log and redo the 10 oldest mistakes each day.', 'Compare with your day-1 diagnostic and check the preliminary forecast for exam day.'] },
      ],
    },
  },
  {
    slug: 'cach-dung-allingo-luyen-toeic',
    category: 'huong-dan',
    publishedAt: '2026-11-02T03:00:00.000Z',
    title: { vi: 'Cách dùng Allingo để luyện TOEIC hiệu quả', en: 'How to get the most out of Allingo for TOEIC' },
    excerpt: {
      vi: 'Từ bài chẩn đoán đến lộ trình, giải thích AI, sổ lỗi và ôn từ vựng theo FSRS – đây là vòng học hằng ngày chúng tôi khuyên dùng.',
      en: 'From the diagnostic to your plan, AI explanations, the error log and FSRS vocabulary reviews – the daily loop we recommend.',
    },
    seo: {
      title: { vi: 'Hướng dẫn dùng Allingo luyện TOEIC | Allingo', en: 'How to use Allingo for TOEIC | Allingo' },
      description: { vi: 'Bài chẩn đoán, lộ trình tuần, giải thích AI song ngữ, sổ lỗi, thẻ từ vựng FSRS và thống kê tiến bộ trên Allingo.', en: 'Diagnostic, weekly plan, bilingual AI explanations, error log, FSRS flashcards and progress stats on Allingo.' },
    },
    content: {
      vi: [
        { p: 'Allingo được thiết kế quanh một vòng học ngắn mỗi ngày. Bạn không cần dùng hết tính năng – chỉ cần làm theo thứ tự dưới đây.' },
        { h2: '1. Bắt đầu bằng bài chẩn đoán' },
        { p: 'Bài chẩn đoán thích ứng (25–30 phút) ước tính điểm Listening, Reading và kỹ năng yếu. Kết quả là đầu vào cho lộ trình.' },
        { h2: '2. Mở "Việc hôm nay"' },
        { p: 'Lộ trình chia số phút bạn có mỗi tuần thành việc cụ thể: ôn từ vựng, luyện Part yếu, đề mini, đề thi thử định kỳ và điểm danh cuối tuần. Việc xong được đánh dấu tự động khi bạn nộp bài.' },
        { h2: '3. Xem giải thích sau khi làm' },
        { p: 'Ở chế độ luyện tập, bạn xem đáp án và **giải thích AI song ngữ** cho từng câu, hoặc hỏi gia sư AI. Khi đang làm đề ở chế độ thi thật, các trợ giúp này bị khoá để kết quả phản ánh đúng năng lực.' },
        { h2: '4. Dùng sổ lỗi' },
        { p: 'Mỗi câu sai được lưu vào sổ lỗi kèm loại lỗi (ngữ pháp, từ vựng, bẫy, diễn đạt lại, quá thời gian…). Bấm **"Làm lại 10 câu sai"** để luyện lại đúng những câu đó, ghi chú điều bạn rút ra và đánh dấu "đã hiểu".' },
        { h2: '5. Ôn từ vựng theo lịch FSRS' },
        { p: 'Thêm từ khi tra trong bài đọc hoặc thêm cả bộ "TOEIC 600 từ theo chủ đề". Mỗi ngày bạn học một số thẻ mới (gói Free 10 thẻ, Pro 30 thẻ) và ôn thẻ đến hạn; thẻ chọn "Lại" sẽ quay lại ngay trong phiên.' },
        { h2: '6. Theo dõi tiến bộ' },
        { p: 'Trang thống kê cho thấy điểm theo thời gian, độ chính xác từng Part so với 30 ngày trước, số phút học mỗi tuần và vị trí của bạn so với người cùng mục tiêu (ẩn danh). Dự báo điểm hiện là **ước tính sơ bộ** dựa trên xu hướng các bài có điểm.' },
      ],
      en: [
        { p: 'Allingo is built around a short daily loop. You do not need every feature – just follow this order.' },
        { h2: '1. Start with the diagnostic' },
        { p: 'The adaptive diagnostic (25–30 minutes) estimates your Listening and Reading scores and weak skills, and feeds your plan.' },
        { h2: '2. Open "Today"' },
        { p: 'Your plan turns your weekly minutes into concrete tasks: vocabulary review, weak-part drills, mini tests, regular mock tests and a weekly check-in. Tasks are marked done automatically when you submit.' },
        { h2: '3. Read explanations after practice' },
        { p: 'In practice mode you can see answers and **bilingual AI explanations**, or ask the AI tutor. During an exam-mode test these helpers are locked so your score stays honest.' },
        { h2: '4. Use the error log' },
        { p: 'Every wrong answer is logged with a mistake type (grammar, vocabulary, trap, paraphrase, timeout…). Tap **"Redo 10 mistakes"**, add a note and mark items as understood.' },
        { h2: '5. Review vocabulary with FSRS' },
        { p: 'Save words while reading or add the whole "TOEIC 600 words by topic" set. Each day you learn a few new cards (Free 10, Pro 30) and review due ones; cards you mark "Again" come back in the same session.' },
        { h2: '6. Track progress' },
        { p: 'Stats show your score over time, accuracy per part versus the previous 30 days, weekly minutes and an anonymous comparison with learners who share your target. The score forecast is a **preliminary estimate** based on your scored tests.' },
      ],
    },
  },
];

const cta = (vi: string, en: string, href: string) => ({ label: { vi, en }, href });

export const SEED_PAGES = [
  {
    slug: 'home',
    title: { vi: 'Allingo – Luyện thi ngoại ngữ cùng AI', en: 'Allingo – AI test prep for language exams' },
    seo: {
      title: { vi: 'Allingo – Luyện thi TOEIC, IELTS, JLPT, HSK cùng AI', en: 'Allingo – AI prep for TOEIC, IELTS, JLPT, HSK' },
      description: { vi: 'Làm đề đúng định dạng, giải thích AI song ngữ từng câu, lộ trình đến ngày thi, sổ lỗi và ôn từ vựng FSRS.', en: 'Exam-format practice, bilingual AI explanations, a plan to exam day, an error log and FSRS vocabulary reviews.' },
    },
    layout: [
      { blockType: 'hero', eyebrow: { vi: 'Ngoại ngữ cho tất cả', en: 'Languages for everyone' }, heading: { vi: 'Luyện thi ngoại ngữ cùng AI – đúng định dạng, đúng lộ trình', en: 'AI test prep – the right format, the right plan' }, subheading: { vi: 'Bắt đầu với bài chẩn đoán miễn phí, nhận lộ trình theo ngày thi và học mỗi ngày với giải thích AI song ngữ.', en: 'Start with a free diagnostic, get a plan for your exam date and study daily with bilingual AI explanations.' }, primaryCta: cta('Làm bài chẩn đoán', 'Take the diagnostic', '/register?next=/toeic/diagnostic'), secondaryCta: cta('Xem bảng giá', 'See pricing', '/pricing') },
      {
        blockType: 'features',
        heading: { vi: 'Mọi thứ bạn cần để lên điểm', en: 'Everything you need to raise your score' },
        items: [
          { icon: 'file-check', title: { vi: 'Đề đúng định dạng', en: 'Exam-format tests' }, body: { vi: 'Đề full, đề mini và luyện theo Part với đồng hồ như thi thật.', en: 'Full tests, mini tests and part drills with a real exam timer.' } },
          { icon: 'sparkles', title: { vi: 'Giải thích AI song ngữ', en: 'Bilingual AI explanations' }, body: { vi: 'Hiểu vì sao đúng, vì sao sai cho từng câu.', en: 'Understand why each option is right or wrong.' } },
          { icon: 'route', title: { vi: 'Lộ trình đến ngày thi', en: 'A plan to exam day' }, body: { vi: 'Chia thời gian theo điểm yếu, tự điều chỉnh mỗi tuần.', en: 'Time split by weak skills, adjusted every week.' } },
          { icon: 'notebook-pen', title: { vi: 'Sổ lỗi thông minh', en: 'Smart error log' }, body: { vi: 'Phân loại lỗi và làm lại đúng các câu sai.', en: 'Mistakes grouped by type, redo exactly those items.' } },
          { icon: 'layers', title: { vi: 'Từ vựng theo FSRS', en: 'FSRS vocabulary' }, body: { vi: 'Ôn đúng lúc sắp quên với bộ TOEIC 600 từ theo chủ đề.', en: 'Review right before you forget, with TOEIC 600 by topic.' } },
          { icon: 'chart-line', title: { vi: 'Thống kê tiến bộ', en: 'Progress stats' }, body: { vi: 'Điểm theo thời gian, độ chính xác từng Part, dự báo sơ bộ.', en: 'Scores over time, per-part accuracy, a preliminary forecast.' } },
        ],
      },
      { blockType: 'pricing', heading: { vi: 'Bắt đầu miễn phí, nâng cấp khi cần', en: 'Start free, upgrade when you need to' }, note: { vi: 'Giá hiển thị theo gói hiện hành; thanh toán VNPay, MoMo, ZaloPay.', en: 'Current plans shown; pay with VNPay, MoMo or ZaloPay.' }, program: 'toeic', highlightPlanCode: 'toeic_pro_yearly' },
      {
        blockType: 'faq',
        heading: { vi: 'Câu hỏi thường gặp', en: 'Frequently asked questions' },
        items: [
          { question: { vi: 'Allingo có miễn phí không?', en: 'Is Allingo free?' }, answer: { vi: 'Có gói Free với bài chẩn đoán, luyện theo Part, giải thích AI và ôn từ vựng trong hạn mức hằng ngày. Gói Pro mở rộng hạn mức và đề thi thử.', en: 'Yes. The Free plan includes the diagnostic, part drills, AI explanations and vocabulary reviews within daily limits. Pro raises the limits and adds mock tests.' } },
          { question: { vi: 'Allingo hỗ trợ những kỳ thi nào?', en: 'Which exams are supported?' }, answer: { vi: 'TOEIC đã sẵn sàng; IELTS, JLPT và HSK sẽ ra mắt theo từng giai đoạn – bạn có thể đăng ký nhận thông báo.', en: 'TOEIC is live; IELTS, JLPT and HSK are coming in stages – sign up to be notified.' } },
          { question: { vi: 'Điểm trên Allingo có phải điểm chính thức?', en: 'Are Allingo scores official?' }, answer: { vi: 'Không. Điểm quy đổi và dự báo là ước tính của Allingo để theo dõi tiến bộ, không thay thế kết quả kỳ thi chính thức.', en: 'No. Scaled scores and forecasts are Allingo estimates to track progress, not official results.' } },
        ],
      },
      { blockType: 'cta', heading: { vi: 'Sẵn sàng bắt đầu?', en: 'Ready to start?' }, body: { vi: 'Mất khoảng 25 phút để biết bạn đang ở đâu và cần học gì.', en: 'About 25 minutes to find out where you stand and what to study.' }, button: cta('Tạo tài khoản miễn phí', 'Create a free account', '/register') },
    ],
  },
  {
    slug: 'toeic',
    title: { vi: 'Luyện thi TOEIC Listening & Reading', en: 'TOEIC Listening & Reading prep' },
    seo: {
      title: { vi: 'Luyện thi TOEIC online cùng AI | Allingo', en: 'Online TOEIC prep with AI | Allingo' },
      description: { vi: 'Đề TOEIC đúng định dạng 7 Part, chế độ thi thật, giải thích AI song ngữ, sổ lỗi và lộ trình theo mục tiêu điểm.', en: 'TOEIC practice in the real 7-part format, exam mode, bilingual AI explanations, an error log and a target-based plan.' },
    },
    layout: [
      { blockType: 'hero', eyebrow: { vi: 'TOEIC Listening & Reading', en: 'TOEIC Listening & Reading' }, heading: { vi: 'Luyện TOEIC đúng định dạng, biết rõ mình sai ở đâu', en: 'Practise TOEIC in the real format and see exactly where you slip' }, subheading: { vi: '7 Part, 200 câu, 120 phút – luyện từng Part hoặc làm đề full ở chế độ thi thật, rồi xem giải thích từng câu.', en: '7 parts, 200 items, 120 minutes – drill each part or take a full test in exam mode, then review every item.' }, primaryCta: cta('Làm bài chẩn đoán TOEIC', 'Take the TOEIC diagnostic', '/register?next=/toeic/diagnostic'), secondaryCta: cta('Đọc mẹo Part 5', 'Read Part 5 tips', '/blog/meo-toeic-part-5') },
      {
        blockType: 'features',
        heading: { vi: 'Luyện cả 7 Part', en: 'Cover all 7 parts' },
        items: [
          { icon: 'image', title: { vi: 'Part 1–2', en: 'Parts 1–2' }, body: { vi: 'Mô tả tranh, hỏi–đáp: luyện bẫy phát âm giống nhau.', en: 'Photos and question–response: train against sound-alike traps.' } },
          { icon: 'headphones', title: { vi: 'Part 3–4', en: 'Parts 3–4' }, body: { vi: 'Hội thoại và bài nói, nghe một lần như thi thật; xem transcript sau khi nộp.', en: 'Conversations and talks played once like the real test; transcripts after you submit.' } },
          { icon: 'pencil-line', title: { vi: 'Part 5–6', en: 'Parts 5–6' }, body: { vi: 'Ngữ pháp, từ loại, từ vựng theo ngữ cảnh – có giới hạn giờ.', en: 'Grammar, word forms and vocabulary in context – with a timer.' } },
          { icon: 'book-open', title: { vi: 'Part 7', en: 'Part 7' }, body: { vi: 'Đọc hiểu một và nhiều đoạn, luyện tìm thông tin và suy luận.', en: 'Single and multiple passages: scanning and inference practice.' } },
        ],
      },
      { blockType: 'pricing', heading: { vi: 'Gói luyện TOEIC', en: 'TOEIC plans' }, program: 'toeic', highlightPlanCode: 'toeic_pro_yearly', note: { vi: 'Free: 2 đề full/tháng; Pro: không giới hạn đề full.', en: 'Free: 2 full tests a month; Pro: unlimited full tests.' } },
      {
        blockType: 'faq',
        heading: { vi: 'Hỏi đáp về luyện TOEIC', en: 'TOEIC prep FAQ' },
        items: [
          { question: { vi: 'Đề trên Allingo có phải đề thi thật?', en: 'Are these real TOEIC tests?' }, answer: { vi: 'Không. Toàn bộ câu hỏi do Allingo tự biên soạn theo đúng định dạng đề. TOEIC là thương hiệu của ETS; Allingo không liên kết và không được ETS chứng nhận.', en: 'No. All items are written by Allingo in the official format. TOEIC is a trademark of ETS; Allingo is not affiliated with or endorsed by ETS.' } },
          { question: { vi: 'Bao lâu thì tôi lên điểm?', en: 'How soon will my score improve?' }, answer: { vi: 'Tuỳ điểm xuất phát và thời gian học. Lộ trình ước tính mức tăng theo số giờ/tuần và cho bạn biết khi nào cần tăng tốc.', en: 'It depends on your starting level and study time. Your plan estimates gains from weekly hours and tells you when to speed up.' } },
          { question: { vi: 'Có luyện được trên điện thoại không?', en: 'Can I practise on my phone?' }, answer: { vi: 'Có. Allingo chạy trên trình duyệt di động và có thể cài như ứng dụng (PWA).', en: 'Yes. Allingo works in mobile browsers and can be installed as an app (PWA).' } },
        ],
      },
      { blockType: 'cta', heading: { vi: 'Biết điểm TOEIC ước tính của bạn trong 25 phút', en: 'Get your estimated TOEIC score in 25 minutes' }, button: cta('Bắt đầu miễn phí', 'Start free', '/register?next=/toeic/diagnostic') },
    ],
  },
];
