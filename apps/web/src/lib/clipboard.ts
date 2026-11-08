/** Sao chép chữ (Clipboard API; trình duyệt chặn/không hỗ trợ → false để màn hình báo "chọn và sao chép thủ công") */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Tải chữ thành tệp (Blob + thẻ a tạm) – dùng cho mã khôi phục MFA; không gửi lên mạng */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Khoá base32 nhóm 4 ký tự cho dễ gõ tay (`ABCD EFGH …`) */
export function groupSecret(secret: string): string {
  return secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();
}
