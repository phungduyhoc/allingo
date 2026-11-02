import { Injectable } from '@nestjs/common';

/** Thông tin liên hệ tối thiểu của người dùng (không ghi log) */
export interface UserContact {
  id: string;
  displayName: string;
  email: string | null;
  locale: string;
  isGuest: boolean;
  status: string;
  createdAt: Date;
}

export type UserContactResolver = (userId: string) => Promise<UserContact | null>;
export type UserContactsResolver = (userIds: string[]) => Promise<UserContact[]>;

/**
 * Danh bạ người dùng đảo phụ thuộc (S8, cùng mẫu PersonalDataRegistry/ExamModeService): iam đăng ký resolver lúc khởi động để
 * module tầng 1 khác (billing – thông tin người mua mặc định trên hoá đơn) đọc tên/email mà không import iam (iam đã import
 * billing) và không truy vấn bảng iam.users.
 */
@Injectable()
export class UserDirectory {
  private resolver: UserContactResolver | null = null;
  private bulk: UserContactsResolver | null = null;

  register(resolver: UserContactResolver, bulk?: UserContactsResolver): void {
    this.resolver = resolver;
    this.bulk = bulk ?? null;
  }

  async contact(userId: string): Promise<UserContact | null> {
    return this.resolver ? this.resolver(userId) : null;
  }

  /** Nhiều người dùng một lần (job theo lô) */
  async contacts(userIds: string[]): Promise<UserContact[]> {
    if (!userIds.length) return [];
    if (this.bulk) return this.bulk(userIds);
    const out = await Promise.all(userIds.map((id) => this.contact(id)));
    return out.filter((c): c is UserContact => !!c);
  }
}
