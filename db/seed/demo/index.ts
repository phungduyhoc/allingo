/* eslint-disable no-console */
import { and, eq, sql } from 'drizzle-orm';
import argon2 from 'argon2';
import type { Db } from '../../src/client.js';
import {
  billingCreditBalances,
  billingCreditLedger,
  billingEntitlements,
  billingPlans,
  billingSubscriptions,
  catalogLessonSteps,
  catalogLessons,
  catalogMediaAssets,
  catalogQuestionSubskills,
  catalogQuestionVersions,
  catalogQuestions,
  catalogSections,
  catalogSubskills,
  catalogTestSetItems,
  catalogTestSetSections,
  catalogTestSets,
  catalogTopics,
  catalogVocabItems,
  catalogVocabListItems,
  catalogVocabLists,
  iamClasses,
  iamOrgMemberships,
  iamOrganizations,
  iamUserRoles,
  iamUsers,
  learnEnrollments,
} from '../../drizzle/schema/index.js';
import { questionContentSchema } from '@allingo/schemas';
import { DEMO_LESSON, DEMO_PART2, DEMO_PART5, DEMO_VOCAB, type DemoQuestion } from './content.js';
import { seedReadingFull01 } from './reading-01.seed.js';

export const DEMO_PASSWORD = 'Allingo@2026';

export const DEMO_USERS = [
  { email: 'learner_free@allingo.dev', displayName: 'Lan (Free)', roles: ['learner'] as const, plan: null },
  {
    email: 'learner_pro@allingo.dev',
    displayName: 'Minh (Pro)',
    roles: ['learner'] as const,
    plan: 'toeic_pro_monthly',
  },
  { email: 'teacher@allingo.dev', displayName: 'Cô Hương', roles: ['learner', 'teacher'] as const, plan: null },
  { email: 'admin@allingo.dev', displayName: 'Admin', roles: ['learner', 'admin', 'editor'] as const, plan: null },
  {
    email: 'org_admin@allingo.dev',
    displayName: 'Trung tâm ABC',
    roles: ['learner', 'org_admin'] as const,
    plan: null,
  },
] as const;

export async function seedDemo(db: Db, opts: { webPublicUrl?: string } = {}): Promise<void> {
  const webUrl = opts.webPublicUrl ?? process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
  const passwordHash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  // ---------------------------------------------------------------- Người dùng
  const userIds = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const [row] = await db
      .insert(iamUsers)
      .values({
        email: u.email,
        passwordHash,
        displayName: u.displayName,
        uiLocale: 'vi',
        explainLocale: 'vi',
        status: 'active',
        isGuest: false,
      })
      .onConflictDoUpdate({
        target: iamUsers.email,
        set: {
          displayName: sql`excluded.display_name`,
          passwordHash: sql`excluded.password_hash`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: iamUsers.id });
    userIds.set(u.email, row!.id);
    for (const role of u.roles) {
      await db
        .insert(iamUserRoles)
        .values({ userId: row!.id, roleCode: role, programCode: null })
        .onConflictDoNothing();
    }
    await db
      .insert(learnEnrollments)
      .values({ userId: row!.id, programCode: 'toeic', targetScore: '750', dailyMinutes: 30, isActive: true })
      .onConflictDoNothing();
    await db
      .insert(billingCreditBalances)
      .values({ ownerType: 'user', ownerId: row!.id, balance: 0 })
      .onConflictDoNothing();
  }
  const adminId = userIds.get('admin@allingo.dev')!;

  // Pro: subscription + entitlements + credit tháng cho learner_pro (idempotent theo source_order_id null & plan)
  const proId = userIds.get('learner_pro@allingo.dev')!;
  const [proPlan] = await db
    .select({ id: billingPlans.id, credits: billingPlans.creditsIncluded, features: billingPlans.features })
    .from(billingPlans)
    .where(eq(billingPlans.code, 'toeic_pro_monthly'));
  if (proPlan) {
    const existing = await db
      .select({ id: billingSubscriptions.id })
      .from(billingSubscriptions)
      .where(and(eq(billingSubscriptions.userId, proId), eq(billingSubscriptions.planId, proPlan.id)))
      .limit(1);
    if (existing.length === 0) {
      const periodEnd = new Date(Date.now() + 30 * 86_400_000);
      const [subRow] = await db
        .insert(billingSubscriptions)
        .values({
          userId: proId,
          planId: proPlan.id,
          programCode: 'toeic',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: false,
        })
        .returning({ id: billingSubscriptions.id });
      const features = Object.keys((proPlan.features ?? {}));
      for (const f of features) {
        await db
          .insert(billingEntitlements)
          .values({
            userId: proId,
            programCode: 'toeic',
            featureCode: f,
            source: 'subscription',
            sourceId: subRow!.id,
            validFrom: new Date(),
            validTo: periodEnd,
          });
      }
      await db.transaction(async (tx) => {
        const [bal] = await tx
          .select({ balance: billingCreditBalances.balance })
          .from(billingCreditBalances)
          .where(and(eq(billingCreditBalances.ownerType, 'user'), eq(billingCreditBalances.ownerId, proId)))
          .for('update');
        const after = (bal?.balance ?? 0) + proPlan.credits;
        await tx
          .insert(billingCreditLedger)
          .values({
            userId: proId,
            delta: proPlan.credits,
            balanceAfter: after,
            reason: 'subscription_grant',
            refType: 'subscription',
            refId: subRow!.id,
            note: 'seed demo',
          });
        await tx
          .update(billingCreditBalances)
          .set({ balance: after, updatedAt: new Date() })
          .where(and(eq(billingCreditBalances.ownerType, 'user'), eq(billingCreditBalances.ownerId, proId)));
      });
    }
  }

  // ---------------------------------------------------------------- Tổ chức & lớp
  const orgAdminId = userIds.get('org_admin@allingo.dev')!;
  const existingOrg = await db
    .select({ id: iamOrganizations.id })
    .from(iamOrganizations)
    .where(eq(iamOrganizations.name, 'Trung tâm Ngoại ngữ ABC (demo)'))
    .limit(1);
  let orgId = existingOrg[0]?.id;
  if (!orgId) {
    const [org] = await db
      .insert(iamOrganizations)
      .values({ name: 'Trung tâm Ngoại ngữ ABC (demo)', type: 'center', settings: {}, status: 'active' })
      .returning({ id: iamOrganizations.id });
    orgId = org!.id;
  }
  const existingClass = await db
    .select({ id: iamClasses.id })
    .from(iamClasses)
    .where(and(eq(iamClasses.orgId, orgId), eq(iamClasses.name, 'TOEIC 650+ Khoá 1')))
    .limit(1);
  let classId = existingClass[0]?.id;
  if (!classId) {
    const [cls] = await db
      .insert(iamClasses)
      .values({
        orgId,
        name: 'TOEIC 650+ Khoá 1',
        programCode: 'toeic',
        teacherUserId: userIds.get('teacher@allingo.dev')!,
      })
      .returning({ id: iamClasses.id });
    classId = cls!.id;
  }
  await db
    .insert(iamOrgMemberships)
    .values({ orgId, userId: orgAdminId, role: 'org_admin', classId: null })
    .onConflictDoNothing();
  await db
    .insert(iamOrgMemberships)
    .values({ orgId, userId: userIds.get('teacher@allingo.dev')!, role: 'teacher', classId })
    .onConflictDoNothing();
  await db
    .insert(iamOrgMemberships)
    .values({ orgId, userId: userIds.get('learner_free@allingo.dev')!, role: 'learner', classId })
    .onConflictDoNothing();

  // ---------------------------------------------------------------- Tra cứu section/subskill/topic
  const sections = await db
    .select({ id: catalogSections.id, code: catalogSections.code })
    .from(catalogSections)
    .where(eq(catalogSections.programCode, 'toeic'));
  const sectionId = new Map(sections.map((s) => [s.code, s.id]));
  const subskills = await db
    .select({ id: catalogSubskills.id, code: catalogSubskills.code })
    .from(catalogSubskills)
    .where(eq(catalogSubskills.programCode, 'toeic'));
  const subskillId = new Map(subskills.map((s) => [s.code, s.id]));
  const topics = await db.select({ id: catalogTopics.id, code: catalogTopics.code }).from(catalogTopics);
  const topicId = new Map(topics.map((t) => [t.code, t.id]));

  // ---------------------------------------------------------------- Audio placeholder cho Part 2
  const mediaIdByKey = new Map<string, string>();
  for (const q of DEMO_PART2) {
    const checksum = `demo:${q.key}`;
    const existing = await db
      .select({ id: catalogMediaAssets.id })
      .from(catalogMediaAssets)
      .where(eq(catalogMediaAssets.checksum, checksum))
      .limit(1);
    let id = existing[0]?.id;
    if (!id) {
      const [m] = await db
        .insert(catalogMediaAssets)
        .values({
          kind: 'audio',
          externalUrl: `${webUrl}/demo-audio/${q.key}.wav`,
          mimeType: 'audio/wav',
          durationMs: 9000,
          license: 'own',
          checksum,
          createdBy: adminId,
          transcript: { text: q.content.evidence ?? '' },
        })
        .returning({ id: catalogMediaAssets.id });
      id = m!.id;
    }
    mediaIdByKey.set(q.key, id);
  }

  // ---------------------------------------------------------------- Câu hỏi + phiên bản
  const questionIdByKey = new Map<string, string>();
  const upsertQuestion = async (q: DemoQuestion) => {
    const content = questionContentSchema.parse(
      q.content.type === 'mcq_single' && mediaIdByKey.has(q.key)
        ? {
            ...q.content,
            media: { ...(q.content.media ?? { listen_policy: 'once' }), audio_asset_id: mediaIdByKey.get(q.key) },
          }
        : q.content,
    );
    const existing = await db
      .select({ questionId: catalogQuestionVersions.questionId, id: catalogQuestionVersions.id })
      .from(catalogQuestionVersions)
      .where(sql`${catalogQuestionVersions.metadata} ->> 'seed_key' = ${q.key}`)
      .limit(1);
    if (existing.length > 0) {
      await db.update(catalogQuestionVersions).set({ content }).where(eq(catalogQuestionVersions.id, existing[0]!.id));
      questionIdByKey.set(q.key, existing[0]!.questionId);
      return;
    }
    const [question] = await db
      .insert(catalogQuestions)
      .values({
        programCode: 'toeic',
        sectionId: sectionId.get(q.section)!,
        questionTypeCode: content.type,
        topicId: q.topic ? (topicId.get(q.topic) ?? null) : null,
        status: 'published',
        source: 'human',
        difficultyTarget: q.difficulty,
        createdBy: adminId,
      })
      .returning({ id: catalogQuestions.id });
    const [version] = await db
      .insert(catalogQuestionVersions)
      .values({
        questionId: question!.id,
        versionNo: 1,
        content,
        metadata: { seed_key: q.key, author: 'allingo-content' },
        changeNote: 'seed demo',
        createdBy: adminId,
      })
      .returning({ id: catalogQuestionVersions.id });
    await db
      .update(catalogQuestions)
      .set({ currentVersionId: version!.id })
      .where(eq(catalogQuestions.id, question!.id));
    if (q.subskill && subskillId.has(q.subskill)) {
      await db
        .insert(catalogQuestionSubskills)
        .values({ questionId: question!.id, subskillId: subskillId.get(q.subskill)!, weight: '1' })
        .onConflictDoNothing();
    }
    questionIdByKey.set(q.key, question!.id);
  };
  for (const q of [...DEMO_PART5, ...DEMO_PART2]) await upsertQuestion(q);

  // ---------------------------------------------------------------- Đề mini
  const upsertTestSet = async (
    code: string,
    title: { vi: string; en: string },
    section: string,
    keys: string[],
    durationSec: number,
  ) => {
    const [ts] = await db
      .insert(catalogTestSets)
      .values({
        programCode: 'toeic',
        code,
        title,
        kind: 'mini',
        isFree: true,
        durationSec,
        status: 'published',
        publishedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [catalogTestSets.programCode, catalogTestSets.code],
        set: { title: sql`excluded.title`, durationSec: sql`excluded.duration_sec`, status: sql`excluded.status` },
      })
      .returning({ id: catalogTestSets.id });
    const testSetId = ts!.id;
    await db
      .insert(catalogTestSetSections)
      .values({ testSetId, sectionId: sectionId.get(section)!, sortOrder: 1, durationSec })
      .onConflictDoNothing();
    await db.delete(catalogTestSetItems).where(eq(catalogTestSetItems.testSetId, testSetId));
    await db
      .insert(catalogTestSetItems)
      .values(
        keys.map((k, i) => ({
          testSetId,
          questionId: questionIdByKey.get(k)!,
          sectionId: sectionId.get(section)!,
          sortOrder: i + 1,
          groupKey: null,
          points: '1',
        })),
      );
    return testSetId;
  };
  const part5SetId = await upsertTestSet(
    'toeic-mini-part5-01',
    { vi: 'TOEIC Mini – Part 5 (10 câu)', en: 'TOEIC Mini – Part 5 (10 questions)' },
    'part5',
    DEMO_PART5.map((q) => q.key),
    480,
  );
  await upsertTestSet(
    'toeic-mini-part2-01',
    { vi: 'TOEIC Mini – Part 2 Nghe (6 câu)', en: 'TOEIC Mini – Part 2 Listening (6 questions)' },
    'part2',
    DEMO_PART2.map((q) => q.key),
    240,
  );

  // ---------------------------------------------------------------- Đề TOEIC Reading đầy đủ 01 + 3 bộ luyện (Sprint 3)
  const reading = await seedReadingFull01(db, { adminId, sectionId, subskillId, topicId });

  // ---------------------------------------------------------------- Từ vựng
  const vocabIds: string[] = [];
  for (const v of DEMO_VOCAB) {
    const existing = await db
      .select({ id: catalogVocabItems.id })
      .from(catalogVocabItems)
      .where(
        and(
          eq(catalogVocabItems.programCode, 'toeic'),
          eq(catalogVocabItems.headword, v.headword),
          eq(catalogVocabItems.kind, 'word'),
        ),
      )
      .limit(1);
    let id = existing[0]?.id;
    if (!id) {
      const [row] = await db
        .insert(catalogVocabItems)
        .values({
          programCode: 'toeic',
          kind: 'word',
          headword: v.headword,
          pos: v.pos,
          ipaUk: v.ipa,
          ipaUs: v.ipa,
          meanings: [{ ...v.meaning }],
          examples: [{ text: v.example }],
          collocations: [],
          level: 'B1',
          source: 'human',
          status: 'published',
        })
        .returning({ id: catalogVocabItems.id });
      id = row!.id;
    }
    vocabIds.push(id);
  }
  const listTitle = { vi: 'TOEIC 20 từ văn phòng cơ bản', en: 'TOEIC 20 essential office words' };
  const existingList = await db
    .select({ id: catalogVocabLists.id })
    .from(catalogVocabLists)
    .where(sql`${catalogVocabLists.title} ->> 'en' = ${listTitle.en}`)
    .limit(1);
  let listId = existingList[0]?.id;
  if (!listId) {
    const [l] = await db
      .insert(catalogVocabLists)
      .values({ programCode: 'toeic', kind: 'core', title: listTitle, isFree: true, sortOrder: 1 })
      .returning({ id: catalogVocabLists.id });
    listId = l!.id;
  }
  await db.delete(catalogVocabListItems).where(eq(catalogVocabListItems.listId, listId));
  await db
    .insert(catalogVocabListItems)
    .values(vocabIds.map((vocabItemId, i) => ({ listId: listId, vocabItemId, sortOrder: i + 1 })));

  // ---------------------------------------------------------------- Bài học
  const existingLesson = await db
    .select({ id: catalogLessons.id })
    .from(catalogLessons)
    .where(sql`${catalogLessons.title} ->> 'en' = ${DEMO_LESSON.title.en}`)
    .limit(1);
  let lessonId = existingLesson[0]?.id;
  if (!lessonId) {
    const [l] = await db
      .insert(catalogLessons)
      .values({
        programCode: 'toeic',
        sectionId: sectionId.get('part5')!,
        kind: 'grammar',
        title: DEMO_LESSON.title,
        summary: DEMO_LESSON.summary,
        estMinutes: DEMO_LESSON.estMinutes,
        isFree: true,
        sortOrder: 1,
        status: 'published',
        source: 'human',
      })
      .returning({ id: catalogLessons.id });
    lessonId = l!.id;
  }
  await db.delete(catalogLessonSteps).where(eq(catalogLessonSteps.lessonId, lessonId));
  await db.insert(catalogLessonSteps).values(
    DEMO_LESSON.steps.map((s, i) => ({
      lessonId: lessonId,
      sortOrder: i + 1,
      stepType: s.type,
      content:
        s.type === 'practice'
          ? {
              question_ids: (s.content as { question_keys: string[] }).question_keys
                .map((k) => questionIdByKey.get(k))
                .filter(Boolean),
              test_set_id: part5SetId,
            }
          : s.content,
    })),
  );

  console.log(
    `[seed:demo] users=${DEMO_USERS.length} questions=${questionIdByKey.size} vocab=${vocabIds.length} org=1 class=1 lesson=1 test_sets=${2 + Object.keys(reading.testSetIds).length}`,
  );
}
