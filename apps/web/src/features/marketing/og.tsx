import { ImageResponse } from 'next/og';

/**
 * Ảnh OG động (S10) 1200×630 – nền navy, vạch vàng, wordmark Allingo, tiêu đề + dòng phụ. Font mặc định của next/og (Geist, có
 * đủ dấu tiếng Việt) – không tải font ngoài. Dùng cho landing (`/[locale]/opengraph-image`) và bài blog.
 */
export const OG_SIZE = { width: 1200, height: 630 };

export function ogImage(o: { title: string; tagline: string; kicker?: string | null; footer?: string | null }): ImageResponse {
  const title = o.title.length > 110 ? `${o.title.slice(0, 107)}…` : o.title;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: '#0B1F4B', color: '#ffffff', padding: '64px 72px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#E6B325', color: '#0B1F4B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 34 }}>A</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontSize: 34, letterSpacing: -0.5 }}>Allingo</span>
            <span style={{ fontSize: 20, color: 'rgba(255,255,255,0.7)' }}>{o.tagline}</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {o.kicker ? <span style={{ fontSize: 26, color: '#E6B325', textTransform: 'uppercase', letterSpacing: 1 }}>{o.kicker}</span> : null}
          <span style={{ fontSize: title.length > 60 ? 54 : 66, lineHeight: 1.15, letterSpacing: -1 }}>{title}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 22, color: 'rgba(255,255,255,0.75)' }}>
          <span>{o.footer ?? 'TOEIC · IELTS · JLPT · HSK'}</span>
          <div style={{ width: 160, height: 8, borderRadius: 4, background: '#E6B325' }} />
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
