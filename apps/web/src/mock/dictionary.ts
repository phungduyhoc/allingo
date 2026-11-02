/**
 * Từ điển giả lập cho chế độ mock (S6) – nội dung TỰ BIÊN SOẠN (không sao chép từ điển/đề thi có bản quyền), đủ để thử
 * popover tra từ: IPA US/UK, nghĩa vi/en, ví dụ, collocations, dạng từ, gợi ý khi gõ sai. Từ không có ở đây → "AI dịch".
 */

export interface MockDictEntry {
  id: string;
  headword: string;
  pos: string;
  ipa_us: string;
  ipa_uk: string;
  meanings: { en: string; vi: string; pos?: string }[];
  examples: { en: string; vi: string }[];
  collocations: string[];
  forms: string[];
  level: string;
  topics: string[];
  /** Có sẵn audio TTS (URL ký) – không có → web gọi GET /tts */
  audio?: boolean;
}

const id = (n: number) => `00000000-0000-4000-8000-${String(900000000000 + n).padStart(12, '0')}`;

export const MOCK_DICTIONARY: MockDictEntry[] = [
  {
    id: id(1),
    headword: 'invoice',
    pos: 'noun',
    ipa_us: '/ˈɪnvɔɪs/',
    ipa_uk: '/ˈɪnvɔɪs/',
    meanings: [
      { en: 'a document listing goods or services and the amount to pay', vi: 'hoá đơn' },
      { en: 'to send someone a bill', vi: 'lập hoá đơn, gửi hoá đơn', pos: 'verb' },
    ],
    examples: [
      {
        en: 'The supplier sent the invoice two days after delivery.',
        vi: 'Nhà cung cấp gửi hoá đơn hai ngày sau khi giao hàng.',
      },
      {
        en: 'We will invoice your company at the end of the month.',
        vi: 'Chúng tôi sẽ gửi hoá đơn cho công ty bạn vào cuối tháng.',
      },
    ],
    collocations: ['issue an invoice', 'pay an invoice', 'invoice number', 'outstanding invoice'],
    forms: ['invoices', 'invoiced', 'invoicing'],
    level: 'B1',
    topics: ['finance', 'office'],
    audio: true,
  },
  {
    id: id(2),
    headword: 'shipment',
    pos: 'noun',
    ipa_us: '/ˈʃɪpmənt/',
    ipa_uk: '/ˈʃɪpmənt/',
    meanings: [{ en: 'a load of goods sent together', vi: 'lô hàng, chuyến hàng' }],
    examples: [{ en: 'The next shipment is expected on Friday.', vi: 'Lô hàng tiếp theo dự kiến đến vào thứ Sáu.' }],
    collocations: ['track a shipment', 'delay a shipment', 'shipment date'],
    forms: ['shipments'],
    level: 'B1',
    topics: ['logistics'],
  },
  {
    id: id(3),
    headword: 'delivery',
    pos: 'noun',
    ipa_us: '/dɪˈlɪvəri/',
    ipa_uk: '/dɪˈlɪvəri/',
    meanings: [{ en: 'the act of taking goods to a place', vi: 'sự giao hàng' }],
    examples: [
      {
        en: 'Free delivery is available for orders over 500,000 dong.',
        vi: 'Miễn phí giao hàng cho đơn trên 500.000 đồng.',
      },
    ],
    collocations: ['delivery note', 'delivery date', 'express delivery'],
    forms: ['deliveries'],
    level: 'A2',
    topics: ['logistics', 'shopping'],
    audio: true,
  },
  {
    id: id(4),
    headword: 'quantity',
    pos: 'noun',
    ipa_us: '/ˈkwɑːntəti/',
    ipa_uk: '/ˈkwɒntəti/',
    meanings: [{ en: 'an amount or number of something', vi: 'số lượng' }],
    examples: [{ en: 'Please check the quantity before signing.', vi: 'Vui lòng kiểm tra số lượng trước khi ký.' }],
    collocations: ['large quantity', 'order quantity'],
    forms: ['quantities'],
    level: 'B1',
    topics: ['logistics'],
  },
  {
    id: id(5),
    headword: 'proposal',
    pos: 'noun',
    ipa_us: '/prəˈpoʊzl/',
    ipa_uk: '/prəˈpəʊzl/',
    meanings: [{ en: 'a formal plan or suggestion', vi: 'bản đề xuất, đề nghị' }],
    examples: [{ en: 'The board approved the budget proposal.', vi: 'Hội đồng đã duyệt bản đề xuất ngân sách.' }],
    collocations: ['submit a proposal', 'reject a proposal', 'project proposal'],
    forms: ['proposals'],
    level: 'B1',
    topics: ['business'],
  },
  {
    id: id(6),
    headword: 'campaign',
    pos: 'noun',
    ipa_us: '/kæmˈpeɪn/',
    ipa_uk: '/kæmˈpeɪn/',
    meanings: [{ en: 'a planned series of activities to reach a goal', vi: 'chiến dịch' }],
    examples: [
      { en: 'The advertising campaign starts next month.', vi: 'Chiến dịch quảng cáo bắt đầu vào tháng tới.' },
    ],
    collocations: ['marketing campaign', 'launch a campaign'],
    forms: ['campaigns'],
    level: 'B1',
    topics: ['marketing'],
  },
  {
    id: id(7),
    headword: 'register',
    pos: 'verb',
    ipa_us: '/ˈredʒɪstər/',
    ipa_uk: '/ˈredʒɪstə(r)/',
    meanings: [
      { en: 'to put your name on an official list', vi: 'đăng ký' },
      { en: 'a machine in a shop that records sales', vi: 'máy tính tiền', pos: 'noun' },
    ],
    examples: [
      { en: 'You must register online before the seminar.', vi: 'Bạn phải đăng ký trực tuyến trước buổi hội thảo.' },
    ],
    collocations: ['register for a course', 'cash register'],
    forms: ['registers', 'registered', 'registering', 'registration'],
    level: 'A2',
    topics: ['office', 'education'],
  },
  {
    id: id(8),
    headword: 'workshop',
    pos: 'noun',
    ipa_us: '/ˈwɜːrkʃɑːp/',
    ipa_uk: '/ˈwɜːkʃɒp/',
    meanings: [
      { en: 'a meeting where people learn about a subject by doing activities', vi: 'buổi hội thảo thực hành' },
    ],
    examples: [
      {
        en: 'The workshop on customer service is fully booked.',
        vi: 'Buổi hội thảo về dịch vụ khách hàng đã kín chỗ.',
      },
    ],
    collocations: ['attend a workshop', 'training workshop'],
    forms: ['workshops'],
    level: 'B1',
    topics: ['education', 'office'],
  },
  {
    id: id(9),
    headword: 'refund',
    pos: 'noun',
    ipa_us: '/ˈriːfʌnd/',
    ipa_uk: '/ˈriːfʌnd/',
    meanings: [
      { en: 'money given back to a customer', vi: 'tiền hoàn lại' },
      { en: 'to give money back', vi: 'hoàn tiền', pos: 'verb' },
    ],
    examples: [
      {
        en: 'You can ask for a full refund within 30 days.',
        vi: 'Bạn có thể yêu cầu hoàn tiền toàn bộ trong 30 ngày.',
      },
    ],
    collocations: ['full refund', 'request a refund', 'issue a refund'],
    forms: ['refunds', 'refunded', 'refunding'],
    level: 'B1',
    topics: ['shopping', 'finance'],
  },
  {
    id: id(10),
    headword: 'purchase',
    pos: 'noun',
    ipa_us: '/ˈpɜːrtʃəs/',
    ipa_uk: '/ˈpɜːtʃəs/',
    meanings: [
      { en: 'something you buy; the act of buying', vi: 'sự mua, món hàng đã mua' },
      { en: 'to buy something', vi: 'mua', pos: 'verb' },
    ],
    examples: [{ en: 'Keep the receipt as proof of purchase.', vi: 'Hãy giữ biên lai làm bằng chứng mua hàng.' }],
    collocations: ['make a purchase', 'proof of purchase', 'purchase order'],
    forms: ['purchases', 'purchased', 'purchasing'],
    level: 'B1',
    topics: ['shopping'],
  },
  {
    id: id(11),
    headword: 'complaint',
    pos: 'noun',
    ipa_us: '/kəmˈpleɪnt/',
    ipa_uk: '/kəmˈpleɪnt/',
    meanings: [{ en: 'a statement that something is wrong or not good enough', vi: 'lời phàn nàn, khiếu nại' }],
    examples: [
      { en: 'The manager responded to the complaint quickly.', vi: 'Quản lý đã phản hồi khiếu nại rất nhanh.' },
    ],
    collocations: ['file a complaint', 'customer complaint', 'handle a complaint'],
    forms: ['complaints'],
    level: 'B1',
    topics: ['customer service'],
  },
  {
    id: id(12),
    headword: 'committee',
    pos: 'noun',
    ipa_us: '/kəˈmɪti/',
    ipa_uk: '/kəˈmɪti/',
    meanings: [{ en: 'a group of people chosen to make decisions', vi: 'uỷ ban, ban' }],
    examples: [{ en: 'The planning committee meets every Tuesday.', vi: 'Ban kế hoạch họp vào mỗi thứ Ba.' }],
    collocations: ['steering committee', 'committee member'],
    forms: ['committees'],
    level: 'B2',
    topics: ['business'],
  },
  {
    id: id(13),
    headword: 'decision',
    pos: 'noun',
    ipa_us: '/dɪˈsɪʒn/',
    ipa_uk: '/dɪˈsɪʒn/',
    meanings: [{ en: 'a choice you make after thinking', vi: 'quyết định' }],
    examples: [{ en: 'We will announce our decision next week.', vi: 'Chúng tôi sẽ công bố quyết định vào tuần tới.' }],
    collocations: ['make a decision', 'final decision'],
    forms: ['decisions'],
    level: 'A2',
    topics: ['business'],
  },
  {
    id: id(14),
    headword: 'renovation',
    pos: 'noun',
    ipa_us: '/ˌrenəˈveɪʃn/',
    ipa_uk: '/ˌrenəˈveɪʃn/',
    meanings: [{ en: 'repair and improvement of a building', vi: 'sự cải tạo, sửa sang' }],
    examples: [{ en: 'The lobby is closed for renovation.', vi: 'Sảnh đang đóng cửa để cải tạo.' }],
    collocations: ['undergo renovation', 'renovation work'],
    forms: ['renovations'],
    level: 'B2',
    topics: ['facilities'],
  },
  {
    id: id(15),
    headword: 'approximately',
    pos: 'adverb',
    ipa_us: '/əˈprɑːksɪmətli/',
    ipa_uk: '/əˈprɒksɪmətli/',
    meanings: [{ en: 'close to an exact number but not exact', vi: 'khoảng, xấp xỉ' }],
    examples: [{ en: 'The trip takes approximately two hours.', vi: 'Chuyến đi mất khoảng hai giờ.' }],
    collocations: [],
    forms: [],
    level: 'B1',
    topics: ['general'],
  },
  {
    id: id(16),
    headword: 'compatible',
    pos: 'adjective',
    ipa_us: '/kəmˈpætəbl/',
    ipa_uk: '/kəmˈpætəbl/',
    meanings: [{ en: 'able to be used together', vi: 'tương thích' }],
    examples: [
      { en: 'This charger is compatible with most phones.', vi: 'Bộ sạc này tương thích với hầu hết điện thoại.' },
    ],
    collocations: ['compatible with', 'fully compatible'],
    forms: ['compatibility'],
    level: 'B2',
    topics: ['technology'],
  },
  {
    id: id(17),
    headword: 'laboratory',
    pos: 'noun',
    ipa_us: '/ˈlæbrətɔːri/',
    ipa_uk: '/ləˈbɒrətri/',
    meanings: [{ en: 'a room used for scientific work', vi: 'phòng thí nghiệm' }],
    examples: [
      { en: 'Visitors may not enter the laboratory alone.', vi: 'Khách không được vào phòng thí nghiệm một mình.' },
    ],
    collocations: ['research laboratory'],
    forms: ['laboratories', 'lab'],
    level: 'B1',
    topics: ['science'],
  },
  {
    id: id(18),
    headword: 'employee',
    pos: 'noun',
    ipa_us: '/ɪmˈplɔɪiː/',
    ipa_uk: '/ɪmˈplɔɪiː/',
    meanings: [{ en: 'a person who is paid to work for a company', vi: 'nhân viên' }],
    examples: [{ en: 'All employees must wear an ID badge.', vi: 'Mọi nhân viên phải đeo thẻ nhân viên.' }],
    collocations: ['full-time employee', 'employee benefits'],
    forms: ['employees'],
    level: 'A2',
    topics: ['office'],
  },
  {
    id: id(19),
    headword: 'customer',
    pos: 'noun',
    ipa_us: '/ˈkʌstəmər/',
    ipa_uk: '/ˈkʌstəmə(r)/',
    meanings: [{ en: 'a person who buys goods or services', vi: 'khách hàng' }],
    examples: [
      {
        en: 'Our customers can order online 24 hours a day.',
        vi: 'Khách hàng có thể đặt hàng trực tuyến 24 giờ mỗi ngày.',
      },
    ],
    collocations: ['customer service', 'regular customer'],
    forms: ['customers'],
    level: 'A2',
    topics: ['customer service'],
  },
  {
    id: id(20),
    headword: 'deadline',
    pos: 'noun',
    ipa_us: '/ˈdedlaɪn/',
    ipa_uk: '/ˈdedlaɪn/',
    meanings: [{ en: 'the latest time by which something must be done', vi: 'hạn chót' }],
    examples: [{ en: 'The deadline for applications is May 15.', vi: 'Hạn chót nộp hồ sơ là ngày 15 tháng 5.' }],
    collocations: ['meet a deadline', 'miss a deadline', 'tight deadline'],
    forms: ['deadlines'],
    level: 'B1',
    topics: ['office'],
  },
];

/** Độ giống theo trigram (giống pg_trgm) – dùng cho gợi ý khi gõ sai */
export function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string) => {
    const p = `  ${s.toLowerCase()} `;
    const out = new Set<string>();
    for (let i = 0; i < p.length - 2; i++) out.add(p.slice(i, i + 3));
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter || 1);
}
