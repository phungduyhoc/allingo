import { Injectable } from '@nestjs/common';
import { getLogger } from '../telemetry/logger.js';

/** Hàm xoá dữ liệu cá nhân của một người dùng thuộc một module; phải idempotent, ném lỗi nếu chưa xoá xong (sẽ thử lại). */
export type PersonalDataPurger = (userId: string) => Promise<number>;

/**
 * Sổ đăng ký xoá dữ liệu cá nhân (CLAUDE.md §9, xoá trong 72 giờ). Module sở hữu dữ liệu tự đăng ký purger lúc khởi động
 * (vd speech: ảnh người học trong catalog.media_assets), để iam.DeletionService không phải truy vấn bảng của module khác
 * và không tạo phụ thuộc vòng giữa các module tầng 1.
 */
@Injectable()
export class PersonalDataRegistry {
  private readonly purgers = new Map<string, PersonalDataPurger>();
  private readonly logger = getLogger({ component: 'personal-data' });

  register(name: string, purger: PersonalDataPurger): void {
    this.purgers.set(name, purger);
  }

  names(): string[] {
    return [...this.purgers.keys()];
  }

  /** Chạy tuần tự mọi purger; lỗi ở một purger → ném lại để yêu cầu xoá chưa completed và được quét lại lần sau. */
  async purgeAll(userId: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const [name, purger] of this.purgers) {
      try {
        out[name] = await purger(userId);
      } catch (err) {
        this.logger.error({ purger: name, err: (err as Error).message }, 'personal data purge failed');
        throw err;
      }
    }
    return out;
  }
}
