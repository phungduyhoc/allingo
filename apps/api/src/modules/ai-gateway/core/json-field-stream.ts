/**
 * Trích dần giá trị một trường chuỗi (vd `reply_markdown`) từ JSON đang stream (structured output) để SSE `delta`
 * gửi VĂN BẢN THUẦN thay vì mảnh JSON (S6 – tutor chat). Chịu được mảnh cắt giữa escape (`\`, `\uXXXX`).
 * Chỉ tìm trường ở bất kỳ cấp nào theo khoá đầu tiên khớp – đủ cho output_schema phẳng của tutor_chat.
 */
export interface JsonFieldStreamer {
  /** Thêm mảnh JSON; trả phần văn bản MỚI giải mã được (có thể rỗng) */
  push(chunk: string): string;
  /** Toàn bộ văn bản đã giải mã */
  readonly text: string;
  /** Đã gặp dấu " đóng của trường */
  readonly done: boolean;
}

const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

export function createJsonFieldStreamer(field: string): JsonFieldStreamer {
  let buf = '';
  let start = -1;
  let pos = 0;
  let out = '';
  let done = false;
  const keyRe = new RegExp(`"${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"`);
  return {
    get text() {
      return out;
    },
    get done() {
      return done;
    },
    push(chunk: string): string {
      if (done) return '';
      buf += chunk;
      if (start < 0) {
        const m = keyRe.exec(buf);
        if (!m) return '';
        start = m.index + m[0].length;
        pos = start;
      }
      let added = '';
      while (pos < buf.length) {
        const c = buf[pos]!;
        if (c === '"') {
          done = true;
          pos++;
          break;
        }
        if (c !== '\\') {
          added += c;
          pos++;
          continue;
        }
        // escape: cần đủ ký tự mới giải mã được
        const n = buf[pos + 1];
        if (n === undefined) break;
        if (n === 'u') {
          const hex = buf.slice(pos + 2, pos + 6);
          if (hex.length < 4) break;
          added += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : '';
          pos += 6;
          continue;
        }
        added += SIMPLE_ESCAPES[n] ?? n;
        pos += 2;
      }
      out += added;
      return added;
    },
  };
}
