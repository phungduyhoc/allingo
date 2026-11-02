import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { addDays, isValidTimeZone, localDate, localTime, minuteOfDay } from '@allingo/planner';
import { JOB_NAMES } from '@allingo/schemas';
import { CLOCK, type Clock } from '../../shared/clock/clock.module.js';
import { JobsService } from '../../shared/queue/jobs.service.js';
import { getLogger } from '../../shared/telemetry/logger.js';
import { UsersService } from '../iam/index.js';
import { GamificationService, PlanService } from '../learning/index.js';
import { NotificationService } from './notify/notification.service.js';

/** Cửa sổ gửi (phút) kể từ giờ nhắc – job chạy mỗi phút, lỡ nhịp vẫn gửi; chống trùng theo ngày (dedupe_key) */
export const REMINDER_WINDOW_MINUTES = 5;
/** Nhắc chuỗi sắp mất lúc 20:00 giờ người học */
export const STREAK_RISK_TIME = '20:00';

export interface ReminderRunResult {
  study_sent: number;
  study_skipped_studied: number;
  streak_sent: number;
  streak_skipped: number;
}

/**
 * Job `notify.study_reminder` (S9): mỗi phút –
 * (1) nhắc học theo `reminder_time` của lộ trình hiện tại ở MÚI GIỜ NGƯỜI HỌC (iam.users.timezone), nội dung từ "Hôm nay"
 *     (số phút còn lại, chuỗi), kênh push + in-app theo tuỳ chọn thông báo/giờ yên lặng (NotificationService, A124);
 * (2) nhắc chuỗi sắp mất lúc 20:00 giờ người học khi chuỗi > 0 mà hôm nay chưa học.
 * Đã học hôm đó (chuỗi ghi hôm nay, bài nộp/lưu nháp trong ngày) → không gửi. Mỗi loại tối đa 1 lần/ngày (dedupe theo ngày).
 */
@Injectable()
export class StudyRemindersService implements OnModuleInit {
  private readonly logger = getLogger({ component: 'growth.reminders' });

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly plans: PlanService,
    private readonly gamification: GamificationService,
    private readonly users: UsersService,
    private readonly notify: NotificationService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    this.jobs.register('notify', JOB_NAMES.STUDY_REMINDER, () => this.run());
  }

  private inWindow(now: Date, tz: string, hhmm: string): boolean {
    const diff = minuteOfDay(localTime(now, tz)) - minuteOfDay(hhmm);
    return diff >= 0 && diff < REMINDER_WINDOW_MINUTES;
  }

  async run(now: Date = new Date(this.clock.now())): Promise<ReminderRunResult> {
    const out: ReminderRunResult = { study_sent: 0, study_skipped_studied: 0, streak_sent: 0, streak_skipped: 0 };
    // (1) nhắc học theo giờ ưa thích
    const cands = await this.plans.reminderCandidates();
    const tzs = await this.users.timezonesFor(cands.map((c) => c.userId));
    for (const c of cands) {
      const u = tzs.get(c.userId);
      if (!u || u.status !== 'active' || u.isGuest) continue;
      const tz = isValidTimeZone(u.timezone) ? u.timezone : c.timezone;
      if (!this.inWindow(now, tz, c.reminderTime)) continue;
      const day = localDate(now, tz);
      if (await this.gamification.studiedOn(c.userId, day, tz)) {
        out.study_skipped_studied++;
        continue;
      }
      const [summary, streak] = await Promise.all([this.plans.todaySummary(c.userId, c.program), this.gamification.streakView(c.userId, c.program)]);
      const r = await this.notify.send(c.userId, 'learning.study_reminder', { minutes: summary.minutes || null, tasks: summary.tasks, streak: streak.current || null, program: c.program }, { dedupeKey: `study_reminder:${c.program}:${day}`, now });
      if (r.results.some((x) => x.status === 'sent')) out.study_sent++;
    }
    // (2) chuỗi sắp mất lúc 20:00
    const streaks = await this.gamification.streakCandidates(addDays(now.toISOString().slice(0, 10), -3));
    const stz = await this.users.timezonesFor(streaks.map((s) => s.userId));
    for (const s of streaks) {
      const u = stz.get(s.userId);
      if (!u || u.status !== 'active' || u.isGuest) continue;
      const tz = isValidTimeZone(u.timezone) ? u.timezone : 'Asia/Ho_Chi_Minh';
      if (!this.inWindow(now, tz, STREAK_RISK_TIME)) continue;
      const day = localDate(now, tz);
      const view = await this.gamification.streakView(s.userId);
      if (!view.at_risk || (await this.gamification.studiedOn(s.userId, day, tz))) {
        out.streak_skipped++;
        continue;
      }
      const r = await this.notify.send(s.userId, 'learning.streak_at_risk', { streak: view.current }, { dedupeKey: `streak_risk:${day}`, now });
      if (r.results.some((x) => x.status === 'sent')) out.streak_sent++;
    }
    if (out.study_sent || out.streak_sent) this.logger.info(out, 'notify.study_reminder');
    return out;
  }
}
