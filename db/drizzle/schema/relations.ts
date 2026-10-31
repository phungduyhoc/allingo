// ⚠️ Tệp sinh tự động bởi db/scripts/organize-schema.ts từ drizzle-kit pull. Không sửa tay —
// thay đổi schema = migration SQL mới trong db/drizzle/migrations + cập nhật docs/spec/allingo-schema.sql, rồi chạy pnpm schema:refresh.
import { relations } from 'drizzle-orm/relations';
import {
  iamUsers,
  iamAuthIdentities,
  iamSessions,
  iamUserRoles,
  iamRoles,
  iamReferrals,
  iamConsents,
  iamDeletionRequests,
  catalogPrograms,
  catalogSkills,
  catalogSections,
  catalogTopics,
  catalogSubskills,
  catalogMediaAssets,
  catalogPassages,
  catalogQuestions,
  catalogQuestionTypes,
  catalogQuestionVersions,
  catalogTestSets,
  catalogGrammarTopics,
  catalogLessons,
  catalogLessonSteps,
  catalogExercises,
  catalogVideos,
  catalogVideoSentences,
  catalogVocabItems,
  catalogVocabLists,
  catalogContentReviews,
  learnEnrollments,
  learnStudyPlans,
  learnPlanWeeks,
  learnPlanTasks,
  learnAttempts,
  learnRecordings,
  learnSubmissions,
  learnGradingResults,
  aiPromptVersions,
  learnPronunciationScores,
  learnPhrasingFixes,
  learnErrorLogEntries,
  learnSrsCards,
  learnSrsReviews,
  learnNotes,
  learnStreaks,
  learnXpEvents,
  learnScoreForecasts,
  learnChatThreads,
  learnChatMessages,
  aiPromptTemplates,
  aiExplanationCache,
  aiEvalSets,
  aiEvalItems,
  aiEvalRuns,
  aiFeedback,
  billingPlans,
  billingPrices,
  billingOrders,
  iamOrganizations,
  billingPromotions,
  billingPayments,
  billingSubscriptions,
  billingEntitlements,
  billingCreditLedger,
  billingInvoices,
  opsNotifications,
  opsNotificationPreferences,
  opsFeedback,
  opsContentReports,
  opsSupportTickets,
  iamClasses,
  learnAssignments,
  catalogQuestionSubskills,
  catalogVocabListItems,
  learnUserBadges,
  learnBadges,
  catalogTestSetSections,
  aiEvalRunItems,
  learnAssignmentSubmissions,
  learnShadowingProgress,
  billingUsageCounters,
  iamOrgMemberships,
  catalogTestSetItems,
  learnSkillMastery,
  learnLessonProgress,
} from './index.js';

export const authIdentitiesInIamRelations = relations(iamAuthIdentities, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [iamAuthIdentities.userId],
    references: [iamUsers.id],
  }),
}));

export const usersInIamRelations = relations(iamUsers, ({ many }) => ({
  iamAuthIdentities: many(iamAuthIdentities),
  iamSessions: many(iamSessions),
  userRolesInIam_userId: many(iamUserRoles, {
    relationName: 'userRolesInIam_userId_usersInIam_id',
  }),
  userRolesInIam_grantedBy: many(iamUserRoles, {
    relationName: 'userRolesInIam_grantedBy_usersInIam_id',
  }),
  referralsInIam_referrerUserId: many(iamReferrals, {
    relationName: 'referralsInIam_referrerUserId_usersInIam_id',
  }),
  referralsInIam_refereeUserId: many(iamReferrals, {
    relationName: 'referralsInIam_refereeUserId_usersInIam_id',
  }),
  iamConsents: many(iamConsents),
  iamDeletionRequests: many(iamDeletionRequests),
  mediaAssetsInCatalogs: many(catalogMediaAssets),
  passagesInCatalogs: many(catalogPassages),
  questionsInCatalogs: many(catalogQuestions),
  questionVersionsInCatalogs: many(catalogQuestionVersions),
  videosInCatalogs: many(catalogVideos),
  vocabListsInCatalogs: many(catalogVocabLists),
  contentReviewsInCatalogs: many(catalogContentReviews),
  enrollmentsInLearns: many(learnEnrollments),
  attemptsInLearns: many(learnAttempts),
  recordingsInLearns: many(learnRecordings),
  submissionsInLearns: many(learnSubmissions),
  errorLogEntriesInLearns: many(learnErrorLogEntries),
  srsCardsInLearns: many(learnSrsCards),
  notesInLearns: many(learnNotes),
  streaksInLearns: many(learnStreaks),
  xpEventsInLearns: many(learnXpEvents),
  chatThreadsInLearns: many(learnChatThreads),
  promptVersionsInAis: many(aiPromptVersions),
  feedbackInAis: many(aiFeedback),
  ordersInBillings: many(billingOrders),
  subscriptionsInBillings: many(billingSubscriptions),
  entitlementsInBillings: many(billingEntitlements),
  creditLedgerInBillings: many(billingCreditLedger),
  opsNotifications: many(opsNotifications),
  opsNotificationPreferences: many(opsNotificationPreferences),
  opsFeedback: many(opsFeedback),
  contentReportsInOps_userId: many(opsContentReports, {
    relationName: 'contentReportsInOps_userId_usersInIam_id',
  }),
  contentReportsInOps_resolvedBy: many(opsContentReports, {
    relationName: 'contentReportsInOps_resolvedBy_usersInIam_id',
  }),
  supportTicketsInOps_userId: many(opsSupportTickets, {
    relationName: 'supportTicketsInOps_userId_usersInIam_id',
  }),
  supportTicketsInOps_assignedTo: many(opsSupportTickets, {
    relationName: 'supportTicketsInOps_assignedTo_usersInIam_id',
  }),
  iamClasses: many(iamClasses),
  assignmentsInLearns: many(learnAssignments),
  userBadgesInLearns: many(learnUserBadges),
  assignmentSubmissionsInLearns: many(learnAssignmentSubmissions),
  shadowingProgressInLearns: many(learnShadowingProgress),
  usageCountersInBillings: many(billingUsageCounters),
  iamOrgMemberships: many(iamOrgMemberships),
  skillMasteryInLearns: many(learnSkillMastery),
  lessonProgressInLearns: many(learnLessonProgress),
}));

export const sessionsInIamRelations = relations(iamSessions, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [iamSessions.userId],
    references: [iamUsers.id],
  }),
}));

export const userRolesInIamRelations = relations(iamUserRoles, ({ one }) => ({
  usersInIam_userId: one(iamUsers, {
    fields: [iamUserRoles.userId],
    references: [iamUsers.id],
    relationName: 'userRolesInIam_userId_usersInIam_id',
  }),
  iamRoles: one(iamRoles, {
    fields: [iamUserRoles.roleCode],
    references: [iamRoles.code],
  }),
  usersInIam_grantedBy: one(iamUsers, {
    fields: [iamUserRoles.grantedBy],
    references: [iamUsers.id],
    relationName: 'userRolesInIam_grantedBy_usersInIam_id',
  }),
}));

export const rolesInIamRelations = relations(iamRoles, ({ many }) => ({
  iamUserRoles: many(iamUserRoles),
}));

export const referralsInIamRelations = relations(iamReferrals, ({ one }) => ({
  usersInIam_referrerUserId: one(iamUsers, {
    fields: [iamReferrals.referrerUserId],
    references: [iamUsers.id],
    relationName: 'referralsInIam_referrerUserId_usersInIam_id',
  }),
  usersInIam_refereeUserId: one(iamUsers, {
    fields: [iamReferrals.refereeUserId],
    references: [iamUsers.id],
    relationName: 'referralsInIam_refereeUserId_usersInIam_id',
  }),
}));

export const consentsInIamRelations = relations(iamConsents, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [iamConsents.userId],
    references: [iamUsers.id],
  }),
}));

export const deletionRequestsInIamRelations = relations(iamDeletionRequests, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [iamDeletionRequests.userId],
    references: [iamUsers.id],
  }),
}));

export const skillsInCatalogRelations = relations(catalogSkills, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogSkills.programCode],
    references: [catalogPrograms.code],
  }),
  sectionsInCatalogs: many(catalogSections),
  subskillsInCatalogs: many(catalogSubskills),
  lessonsInCatalogs: many(catalogLessons),
  planWeeksInLearns: many(learnPlanWeeks),
}));

export const programsInCatalogRelations = relations(catalogPrograms, ({ many }) => ({
  skillsInCatalogs: many(catalogSkills),
  sectionsInCatalogs: many(catalogSections),
  topicsInCatalogs: many(catalogTopics),
  subskillsInCatalogs: many(catalogSubskills),
  passagesInCatalogs: many(catalogPassages),
  questionsInCatalogs: many(catalogQuestions),
  testSetsInCatalogs: many(catalogTestSets),
  grammarTopicsInCatalogs: many(catalogGrammarTopics),
  lessonsInCatalogs: many(catalogLessons),
  exercisesInCatalogs: many(catalogExercises),
  videosInCatalogs: many(catalogVideos),
  vocabItemsInCatalogs: many(catalogVocabItems),
  vocabListsInCatalogs: many(catalogVocabLists),
  enrollmentsInLearns: many(learnEnrollments),
  attemptsInLearns: many(learnAttempts),
  submissionsInLearns: many(learnSubmissions),
  errorLogEntriesInLearns: many(learnErrorLogEntries),
  srsCardsInLearns: many(learnSrsCards),
  chatThreadsInLearns: many(learnChatThreads),
  promptTemplatesInAis: many(aiPromptTemplates),
  evalSetsInAis: many(aiEvalSets),
  subscriptionsInBillings: many(billingSubscriptions),
  entitlementsInBillings: many(billingEntitlements),
  skillMasteryInLearns: many(learnSkillMastery),
}));

export const sectionsInCatalogRelations = relations(catalogSections, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogSections.programCode],
    references: [catalogPrograms.code],
  }),
  catalogSkills: one(catalogSkills, {
    fields: [catalogSections.skillId],
    references: [catalogSkills.id],
  }),
  questionsInCatalogs: many(catalogQuestions),
  lessonsInCatalogs: many(catalogLessons),
  planWeeksInLearns: many(learnPlanWeeks),
  attemptsInLearns: many(learnAttempts),
  testSetSectionsInCatalogs: many(catalogTestSetSections),
  testSetItemsInCatalogs: many(catalogTestSetItems),
}));

export const topicsInCatalogRelations = relations(catalogTopics, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogTopics.programCode],
    references: [catalogPrograms.code],
  }),
  passagesInCatalogs: many(catalogPassages),
  questionsInCatalogs: many(catalogQuestions),
  vocabListsInCatalogs: many(catalogVocabLists),
}));

export const subskillsInCatalogRelations = relations(catalogSubskills, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogSubskills.programCode],
    references: [catalogPrograms.code],
  }),
  catalogSkills: one(catalogSkills, {
    fields: [catalogSubskills.skillId],
    references: [catalogSkills.id],
  }),
  errorLogEntriesInLearns: many(learnErrorLogEntries),
  questionSubskillsInCatalogs: many(catalogQuestionSubskills),
  skillMasteryInLearns: many(learnSkillMastery),
}));

export const mediaAssetsInCatalogRelations = relations(catalogMediaAssets, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [catalogMediaAssets.createdBy],
    references: [iamUsers.id],
  }),
  passagesInCatalogs: many(catalogPassages),
  vocabItemsInCatalogs_audioUkId: many(catalogVocabItems, {
    relationName: 'vocabItemsInCatalog_audioUkId_mediaAssetsInCatalog_id',
  }),
  vocabItemsInCatalogs_audioUsId: many(catalogVocabItems, {
    relationName: 'vocabItemsInCatalog_audioUsId_mediaAssetsInCatalog_id',
  }),
  submissionsInLearns: many(learnSubmissions),
}));

export const passagesInCatalogRelations = relations(catalogPassages, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogPassages.programCode],
    references: [catalogPrograms.code],
  }),
  catalogMediaAssets: one(catalogMediaAssets, {
    fields: [catalogPassages.mediaAssetId],
    references: [catalogMediaAssets.id],
  }),
  catalogTopics: one(catalogTopics, {
    fields: [catalogPassages.topicId],
    references: [catalogTopics.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [catalogPassages.createdBy],
    references: [iamUsers.id],
  }),
  questionsInCatalogs: many(catalogQuestions),
}));

export const questionsInCatalogRelations = relations(catalogQuestions, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogQuestions.programCode],
    references: [catalogPrograms.code],
  }),
  catalogSections: one(catalogSections, {
    fields: [catalogQuestions.sectionId],
    references: [catalogSections.id],
  }),
  catalogQuestionTypes: one(catalogQuestionTypes, {
    fields: [catalogQuestions.questionTypeCode],
    references: [catalogQuestionTypes.code],
  }),
  catalogPassages: one(catalogPassages, {
    fields: [catalogQuestions.passageId],
    references: [catalogPassages.id],
  }),
  catalogTopics: one(catalogTopics, {
    fields: [catalogQuestions.topicId],
    references: [catalogTopics.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [catalogQuestions.createdBy],
    references: [iamUsers.id],
  }),
  catalogQuestionVersions: one(catalogQuestionVersions, {
    fields: [catalogQuestions.currentVersionId],
    references: [catalogQuestionVersions.id],
    relationName: 'questionsInCatalog_currentVersionId_questionVersionsInCatalog_id',
  }),
  questionVersionsInCatalogs: many(catalogQuestionVersions, {
    relationName: 'questionVersionsInCatalog_questionId_questionsInCatalog_id',
  }),
  errorLogEntriesInLearns: many(learnErrorLogEntries),
  notesInLearns: many(learnNotes),
  questionSubskillsInCatalogs: many(catalogQuestionSubskills),
  testSetItemsInCatalogs: many(catalogTestSetItems),
}));

export const questionTypesInCatalogRelations = relations(catalogQuestionTypes, ({ many }) => ({
  questionsInCatalogs: many(catalogQuestions),
}));

export const questionVersionsInCatalogRelations = relations(catalogQuestionVersions, ({ one, many }) => ({
  questionsInCatalogs: many(catalogQuestions, {
    relationName: 'questionsInCatalog_currentVersionId_questionVersionsInCatalog_id',
  }),
  catalogQuestions: one(catalogQuestions, {
    fields: [catalogQuestionVersions.questionId],
    references: [catalogQuestions.id],
    relationName: 'questionVersionsInCatalog_questionId_questionsInCatalog_id',
  }),
  iamUsers: one(iamUsers, {
    fields: [catalogQuestionVersions.createdBy],
    references: [iamUsers.id],
  }),
  explanationCacheInAis: many(aiExplanationCache),
}));

export const testSetsInCatalogRelations = relations(catalogTestSets, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogTestSets.programCode],
    references: [catalogPrograms.code],
  }),
  vocabListsInCatalogs: many(catalogVocabLists),
  attemptsInLearns: many(learnAttempts),
  notesInLearns: many(learnNotes),
  testSetSectionsInCatalogs: many(catalogTestSetSections),
  testSetItemsInCatalogs: many(catalogTestSetItems),
}));

export const grammarTopicsInCatalogRelations = relations(catalogGrammarTopics, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogGrammarTopics.programCode],
    references: [catalogPrograms.code],
  }),
  lessonsInCatalogs: many(catalogLessons),
  exercisesInCatalogs: many(catalogExercises),
}));

export const lessonsInCatalogRelations = relations(catalogLessons, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogLessons.programCode],
    references: [catalogPrograms.code],
  }),
  catalogSkills: one(catalogSkills, {
    fields: [catalogLessons.skillId],
    references: [catalogSkills.id],
  }),
  catalogSections: one(catalogSections, {
    fields: [catalogLessons.sectionId],
    references: [catalogSections.id],
  }),
  catalogGrammarTopics: one(catalogGrammarTopics, {
    fields: [catalogLessons.grammarTopicId],
    references: [catalogGrammarTopics.id],
  }),
  lessonStepsInCatalogs: many(catalogLessonSteps),
  exercisesInCatalogs: many(catalogExercises),
  lessonProgressInLearns: many(learnLessonProgress),
}));

export const lessonStepsInCatalogRelations = relations(catalogLessonSteps, ({ one }) => ({
  catalogLessons: one(catalogLessons, {
    fields: [catalogLessonSteps.lessonId],
    references: [catalogLessons.id],
  }),
}));

export const exercisesInCatalogRelations = relations(catalogExercises, ({ one }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogExercises.programCode],
    references: [catalogPrograms.code],
  }),
  catalogLessons: one(catalogLessons, {
    fields: [catalogExercises.lessonId],
    references: [catalogLessons.id],
  }),
  catalogGrammarTopics: one(catalogGrammarTopics, {
    fields: [catalogExercises.grammarTopicId],
    references: [catalogGrammarTopics.id],
  }),
}));

export const videosInCatalogRelations = relations(catalogVideos, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogVideos.programCode],
    references: [catalogPrograms.code],
  }),
  iamUsers: one(iamUsers, {
    fields: [catalogVideos.submittedBy],
    references: [iamUsers.id],
  }),
  videoSentencesInCatalogs: many(catalogVideoSentences),
  shadowingProgressInLearns: many(learnShadowingProgress),
}));

export const videoSentencesInCatalogRelations = relations(catalogVideoSentences, ({ one }) => ({
  catalogVideos: one(catalogVideos, {
    fields: [catalogVideoSentences.videoId],
    references: [catalogVideos.id],
  }),
}));

export const vocabItemsInCatalogRelations = relations(catalogVocabItems, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogVocabItems.programCode],
    references: [catalogPrograms.code],
  }),
  mediaAssetsInCatalog_audioUkId: one(catalogMediaAssets, {
    fields: [catalogVocabItems.audioUkId],
    references: [catalogMediaAssets.id],
    relationName: 'vocabItemsInCatalog_audioUkId_mediaAssetsInCatalog_id',
  }),
  mediaAssetsInCatalog_audioUsId: one(catalogMediaAssets, {
    fields: [catalogVocabItems.audioUsId],
    references: [catalogMediaAssets.id],
    relationName: 'vocabItemsInCatalog_audioUsId_mediaAssetsInCatalog_id',
  }),
  vocabListItemsInCatalogs: many(catalogVocabListItems),
}));

export const vocabListsInCatalogRelations = relations(catalogVocabLists, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [catalogVocabLists.programCode],
    references: [catalogPrograms.code],
  }),
  catalogTestSets: one(catalogTestSets, {
    fields: [catalogVocabLists.testSetId],
    references: [catalogTestSets.id],
  }),
  catalogTopics: one(catalogTopics, {
    fields: [catalogVocabLists.topicId],
    references: [catalogTopics.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [catalogVocabLists.ownerUserId],
    references: [iamUsers.id],
  }),
  vocabListItemsInCatalogs: many(catalogVocabListItems),
}));

export const contentReviewsInCatalogRelations = relations(catalogContentReviews, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [catalogContentReviews.reviewerId],
    references: [iamUsers.id],
  }),
}));

export const enrollmentsInLearnRelations = relations(learnEnrollments, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnEnrollments.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [learnEnrollments.programCode],
    references: [catalogPrograms.code],
  }),
  studyPlansInLearns: many(learnStudyPlans),
  scoreForecastsInLearns: many(learnScoreForecasts),
}));

export const studyPlansInLearnRelations = relations(learnStudyPlans, ({ one, many }) => ({
  learnEnrollments: one(learnEnrollments, {
    fields: [learnStudyPlans.enrollmentId],
    references: [learnEnrollments.id],
  }),
  planWeeksInLearns: many(learnPlanWeeks),
}));

export const planWeeksInLearnRelations = relations(learnPlanWeeks, ({ one, many }) => ({
  learnStudyPlans: one(learnStudyPlans, {
    fields: [learnPlanWeeks.planId],
    references: [learnStudyPlans.id],
  }),
  catalogSkills: one(catalogSkills, {
    fields: [learnPlanWeeks.focusSkillId],
    references: [catalogSkills.id],
  }),
  catalogSections: one(catalogSections, {
    fields: [learnPlanWeeks.focusSectionId],
    references: [catalogSections.id],
  }),
  planTasksInLearns: many(learnPlanTasks),
}));

export const planTasksInLearnRelations = relations(learnPlanTasks, ({ one, many }) => ({
  learnPlanWeeks: one(learnPlanWeeks, {
    fields: [learnPlanTasks.planWeekId],
    references: [learnPlanWeeks.id],
  }),
  attemptsInLearns: many(learnAttempts),
}));

export const attemptsInLearnRelations = relations(learnAttempts, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnAttempts.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [learnAttempts.programCode],
    references: [catalogPrograms.code],
  }),
  catalogTestSets: one(catalogTestSets, {
    fields: [learnAttempts.testSetId],
    references: [catalogTestSets.id],
  }),
  catalogSections: one(catalogSections, {
    fields: [learnAttempts.sectionId],
    references: [catalogSections.id],
  }),
  learnPlanTasks: one(learnPlanTasks, {
    fields: [learnAttempts.planTaskId],
    references: [learnPlanTasks.id],
  }),
  submissionsInLearns: many(learnSubmissions),
}));

export const recordingsInLearnRelations = relations(learnRecordings, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnRecordings.userId],
    references: [iamUsers.id],
  }),
  submissionsInLearns: many(learnSubmissions),
}));

export const submissionsInLearnRelations = relations(learnSubmissions, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnSubmissions.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [learnSubmissions.programCode],
    references: [catalogPrograms.code],
  }),
  learnAttempts: one(learnAttempts, {
    fields: [learnSubmissions.attemptId],
    references: [learnAttempts.id],
  }),
  learnSubmissions: one(learnSubmissions, {
    fields: [learnSubmissions.parentSubmissionId],
    references: [learnSubmissions.id],
    relationName: 'submissionsInLearn_parentSubmissionId_submissionsInLearn_id',
  }),
  submissionsInLearns: many(learnSubmissions, {
    relationName: 'submissionsInLearn_parentSubmissionId_submissionsInLearn_id',
  }),
  learnRecordings: one(learnRecordings, {
    fields: [learnSubmissions.recordingId],
    references: [learnRecordings.id],
  }),
  catalogMediaAssets: one(catalogMediaAssets, {
    fields: [learnSubmissions.attachmentId],
    references: [catalogMediaAssets.id],
  }),
  gradingResultsInLearns: many(learnGradingResults),
  pronunciationScoresInLearns: many(learnPronunciationScores),
  errorLogEntriesInLearns: many(learnErrorLogEntries),
}));

export const gradingResultsInLearnRelations = relations(learnGradingResults, ({ one, many }) => ({
  learnSubmissions: one(learnSubmissions, {
    fields: [learnGradingResults.submissionId],
    references: [learnSubmissions.id],
  }),
  aiPromptVersions: one(aiPromptVersions, {
    fields: [learnGradingResults.promptVersionId],
    references: [aiPromptVersions.id],
  }),
  phrasingFixesInLearns: many(learnPhrasingFixes),
}));

export const promptVersionsInAiRelations = relations(aiPromptVersions, ({ one, many }) => ({
  gradingResultsInLearns: many(learnGradingResults),
  aiPromptTemplates: one(aiPromptTemplates, {
    fields: [aiPromptVersions.templateId],
    references: [aiPromptTemplates.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [aiPromptVersions.createdBy],
    references: [iamUsers.id],
  }),
  explanationCacheInAis: many(aiExplanationCache),
  evalRunsInAis: many(aiEvalRuns),
}));

export const pronunciationScoresInLearnRelations = relations(learnPronunciationScores, ({ one }) => ({
  learnSubmissions: one(learnSubmissions, {
    fields: [learnPronunciationScores.submissionId],
    references: [learnSubmissions.id],
  }),
}));

export const phrasingFixesInLearnRelations = relations(learnPhrasingFixes, ({ one }) => ({
  learnGradingResults: one(learnGradingResults, {
    fields: [learnPhrasingFixes.gradingResultId],
    references: [learnGradingResults.id],
  }),
}));

export const errorLogEntriesInLearnRelations = relations(learnErrorLogEntries, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnErrorLogEntries.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [learnErrorLogEntries.programCode],
    references: [catalogPrograms.code],
  }),
  learnSubmissions: one(learnSubmissions, {
    fields: [learnErrorLogEntries.submissionId],
    references: [learnSubmissions.id],
  }),
  catalogQuestions: one(catalogQuestions, {
    fields: [learnErrorLogEntries.questionId],
    references: [catalogQuestions.id],
  }),
  catalogSubskills: one(catalogSubskills, {
    fields: [learnErrorLogEntries.subskillId],
    references: [catalogSubskills.id],
  }),
}));

export const srsCardsInLearnRelations = relations(learnSrsCards, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnSrsCards.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [learnSrsCards.programCode],
    references: [catalogPrograms.code],
  }),
  srsReviewsInLearns: many(learnSrsReviews),
}));

export const srsReviewsInLearnRelations = relations(learnSrsReviews, ({ one }) => ({
  learnSrsCards: one(learnSrsCards, {
    fields: [learnSrsReviews.cardId],
    references: [learnSrsCards.id],
  }),
}));

export const notesInLearnRelations = relations(learnNotes, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnNotes.userId],
    references: [iamUsers.id],
  }),
  catalogTestSets: one(catalogTestSets, {
    fields: [learnNotes.testSetId],
    references: [catalogTestSets.id],
  }),
  catalogQuestions: one(catalogQuestions, {
    fields: [learnNotes.questionId],
    references: [catalogQuestions.id],
  }),
}));

export const streaksInLearnRelations = relations(learnStreaks, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnStreaks.userId],
    references: [iamUsers.id],
  }),
}));

export const xpEventsInLearnRelations = relations(learnXpEvents, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnXpEvents.userId],
    references: [iamUsers.id],
  }),
}));

export const scoreForecastsInLearnRelations = relations(learnScoreForecasts, ({ one }) => ({
  learnEnrollments: one(learnEnrollments, {
    fields: [learnScoreForecasts.enrollmentId],
    references: [learnEnrollments.id],
  }),
}));

export const chatThreadsInLearnRelations = relations(learnChatThreads, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnChatThreads.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [learnChatThreads.programCode],
    references: [catalogPrograms.code],
  }),
  chatMessagesInLearns: many(learnChatMessages),
}));

export const chatMessagesInLearnRelations = relations(learnChatMessages, ({ one }) => ({
  learnChatThreads: one(learnChatThreads, {
    fields: [learnChatMessages.threadId],
    references: [learnChatThreads.id],
  }),
}));

export const promptTemplatesInAiRelations = relations(aiPromptTemplates, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [aiPromptTemplates.programCode],
    references: [catalogPrograms.code],
  }),
  promptVersionsInAis: many(aiPromptVersions),
}));

export const explanationCacheInAiRelations = relations(aiExplanationCache, ({ one }) => ({
  catalogQuestionVersions: one(catalogQuestionVersions, {
    fields: [aiExplanationCache.questionVersionId],
    references: [catalogQuestionVersions.id],
  }),
  aiPromptVersions: one(aiPromptVersions, {
    fields: [aiExplanationCache.promptVersionId],
    references: [aiPromptVersions.id],
  }),
}));

export const evalSetsInAiRelations = relations(aiEvalSets, ({ one, many }) => ({
  catalogPrograms: one(catalogPrograms, {
    fields: [aiEvalSets.programCode],
    references: [catalogPrograms.code],
  }),
  evalItemsInAis: many(aiEvalItems),
  evalRunsInAis: many(aiEvalRuns),
}));

export const evalItemsInAiRelations = relations(aiEvalItems, ({ one, many }) => ({
  aiEvalSets: one(aiEvalSets, {
    fields: [aiEvalItems.evalSetId],
    references: [aiEvalSets.id],
  }),
  evalRunItemsInAis: many(aiEvalRunItems),
}));

export const evalRunsInAiRelations = relations(aiEvalRuns, ({ one, many }) => ({
  aiEvalSets: one(aiEvalSets, {
    fields: [aiEvalRuns.evalSetId],
    references: [aiEvalSets.id],
  }),
  aiPromptVersions: one(aiPromptVersions, {
    fields: [aiEvalRuns.promptVersionId],
    references: [aiPromptVersions.id],
  }),
  evalRunItemsInAis: many(aiEvalRunItems),
}));

export const feedbackInAiRelations = relations(aiFeedback, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [aiFeedback.userId],
    references: [iamUsers.id],
  }),
}));

export const pricesInBillingRelations = relations(billingPrices, ({ one, many }) => ({
  billingPlans: one(billingPlans, {
    fields: [billingPrices.planId],
    references: [billingPlans.id],
  }),
  ordersInBillings: many(billingOrders),
}));

export const plansInBillingRelations = relations(billingPlans, ({ many }) => ({
  pricesInBillings: many(billingPrices),
  ordersInBillings: many(billingOrders),
  subscriptionsInBillings: many(billingSubscriptions),
}));

export const ordersInBillingRelations = relations(billingOrders, ({ one, many }) => ({
  iamUsers: one(iamUsers, {
    fields: [billingOrders.userId],
    references: [iamUsers.id],
  }),
  iamOrganizations: one(iamOrganizations, {
    fields: [billingOrders.orgId],
    references: [iamOrganizations.id],
  }),
  billingPlans: one(billingPlans, {
    fields: [billingOrders.planId],
    references: [billingPlans.id],
  }),
  billingPrices: one(billingPrices, {
    fields: [billingOrders.priceId],
    references: [billingPrices.id],
  }),
  billingPromotions: one(billingPromotions, {
    fields: [billingOrders.promotionId],
    references: [billingPromotions.id],
  }),
  paymentsInBillings: many(billingPayments),
  subscriptionsInBillings: many(billingSubscriptions),
  invoicesInBillings: many(billingInvoices),
}));

export const organizationsInIamRelations = relations(iamOrganizations, ({ many }) => ({
  ordersInBillings: many(billingOrders),
  subscriptionsInBillings: many(billingSubscriptions),
  creditLedgerInBillings: many(billingCreditLedger),
  iamClasses: many(iamClasses),
  assignmentsInLearns: many(learnAssignments),
  iamOrgMemberships: many(iamOrgMemberships),
}));

export const promotionsInBillingRelations = relations(billingPromotions, ({ many }) => ({
  ordersInBillings: many(billingOrders),
}));

export const paymentsInBillingRelations = relations(billingPayments, ({ one }) => ({
  billingOrders: one(billingOrders, {
    fields: [billingPayments.orderId],
    references: [billingOrders.id],
  }),
}));

export const subscriptionsInBillingRelations = relations(billingSubscriptions, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [billingSubscriptions.userId],
    references: [iamUsers.id],
  }),
  iamOrganizations: one(iamOrganizations, {
    fields: [billingSubscriptions.orgId],
    references: [iamOrganizations.id],
  }),
  billingPlans: one(billingPlans, {
    fields: [billingSubscriptions.planId],
    references: [billingPlans.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [billingSubscriptions.programCode],
    references: [catalogPrograms.code],
  }),
  billingOrders: one(billingOrders, {
    fields: [billingSubscriptions.sourceOrderId],
    references: [billingOrders.id],
  }),
}));

export const entitlementsInBillingRelations = relations(billingEntitlements, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [billingEntitlements.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [billingEntitlements.programCode],
    references: [catalogPrograms.code],
  }),
}));

export const creditLedgerInBillingRelations = relations(billingCreditLedger, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [billingCreditLedger.userId],
    references: [iamUsers.id],
  }),
  iamOrganizations: one(iamOrganizations, {
    fields: [billingCreditLedger.orgId],
    references: [iamOrganizations.id],
  }),
}));

export const invoicesInBillingRelations = relations(billingInvoices, ({ one }) => ({
  billingOrders: one(billingOrders, {
    fields: [billingInvoices.orderId],
    references: [billingOrders.id],
  }),
}));

export const notificationsInOpsRelations = relations(opsNotifications, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [opsNotifications.userId],
    references: [iamUsers.id],
  }),
}));

export const notificationPreferencesInOpsRelations = relations(opsNotificationPreferences, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [opsNotificationPreferences.userId],
    references: [iamUsers.id],
  }),
}));

export const feedbackInOpsRelations = relations(opsFeedback, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [opsFeedback.userId],
    references: [iamUsers.id],
  }),
}));

export const contentReportsInOpsRelations = relations(opsContentReports, ({ one }) => ({
  usersInIam_userId: one(iamUsers, {
    fields: [opsContentReports.userId],
    references: [iamUsers.id],
    relationName: 'contentReportsInOps_userId_usersInIam_id',
  }),
  usersInIam_resolvedBy: one(iamUsers, {
    fields: [opsContentReports.resolvedBy],
    references: [iamUsers.id],
    relationName: 'contentReportsInOps_resolvedBy_usersInIam_id',
  }),
}));

export const supportTicketsInOpsRelations = relations(opsSupportTickets, ({ one }) => ({
  usersInIam_userId: one(iamUsers, {
    fields: [opsSupportTickets.userId],
    references: [iamUsers.id],
    relationName: 'supportTicketsInOps_userId_usersInIam_id',
  }),
  usersInIam_assignedTo: one(iamUsers, {
    fields: [opsSupportTickets.assignedTo],
    references: [iamUsers.id],
    relationName: 'supportTicketsInOps_assignedTo_usersInIam_id',
  }),
}));

export const classesInIamRelations = relations(iamClasses, ({ one, many }) => ({
  iamOrganizations: one(iamOrganizations, {
    fields: [iamClasses.orgId],
    references: [iamOrganizations.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [iamClasses.teacherUserId],
    references: [iamUsers.id],
  }),
  assignmentsInLearns: many(learnAssignments),
  iamOrgMemberships: many(iamOrgMemberships),
}));

export const assignmentsInLearnRelations = relations(learnAssignments, ({ one, many }) => ({
  iamOrganizations: one(iamOrganizations, {
    fields: [learnAssignments.orgId],
    references: [iamOrganizations.id],
  }),
  iamClasses: one(iamClasses, {
    fields: [learnAssignments.classId],
    references: [iamClasses.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [learnAssignments.createdBy],
    references: [iamUsers.id],
  }),
  assignmentSubmissionsInLearns: many(learnAssignmentSubmissions),
}));

export const questionSubskillsInCatalogRelations = relations(catalogQuestionSubskills, ({ one }) => ({
  catalogQuestions: one(catalogQuestions, {
    fields: [catalogQuestionSubskills.questionId],
    references: [catalogQuestions.id],
  }),
  catalogSubskills: one(catalogSubskills, {
    fields: [catalogQuestionSubskills.subskillId],
    references: [catalogSubskills.id],
  }),
}));

export const vocabListItemsInCatalogRelations = relations(catalogVocabListItems, ({ one }) => ({
  catalogVocabLists: one(catalogVocabLists, {
    fields: [catalogVocabListItems.listId],
    references: [catalogVocabLists.id],
  }),
  catalogVocabItems: one(catalogVocabItems, {
    fields: [catalogVocabListItems.vocabItemId],
    references: [catalogVocabItems.id],
  }),
}));

export const userBadgesInLearnRelations = relations(learnUserBadges, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnUserBadges.userId],
    references: [iamUsers.id],
  }),
  learnBadges: one(learnBadges, {
    fields: [learnUserBadges.badgeCode],
    references: [learnBadges.code],
  }),
}));

export const badgesInLearnRelations = relations(learnBadges, ({ many }) => ({
  userBadgesInLearns: many(learnUserBadges),
}));

export const testSetSectionsInCatalogRelations = relations(catalogTestSetSections, ({ one }) => ({
  catalogTestSets: one(catalogTestSets, {
    fields: [catalogTestSetSections.testSetId],
    references: [catalogTestSets.id],
  }),
  catalogSections: one(catalogSections, {
    fields: [catalogTestSetSections.sectionId],
    references: [catalogSections.id],
  }),
}));

export const evalRunItemsInAiRelations = relations(aiEvalRunItems, ({ one }) => ({
  aiEvalRuns: one(aiEvalRuns, {
    fields: [aiEvalRunItems.runId],
    references: [aiEvalRuns.id],
  }),
  aiEvalItems: one(aiEvalItems, {
    fields: [aiEvalRunItems.evalItemId],
    references: [aiEvalItems.id],
  }),
}));

export const assignmentSubmissionsInLearnRelations = relations(learnAssignmentSubmissions, ({ one }) => ({
  learnAssignments: one(learnAssignments, {
    fields: [learnAssignmentSubmissions.assignmentId],
    references: [learnAssignments.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [learnAssignmentSubmissions.userId],
    references: [iamUsers.id],
  }),
}));

export const shadowingProgressInLearnRelations = relations(learnShadowingProgress, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnShadowingProgress.userId],
    references: [iamUsers.id],
  }),
  catalogVideos: one(catalogVideos, {
    fields: [learnShadowingProgress.videoId],
    references: [catalogVideos.id],
  }),
}));

export const usageCountersInBillingRelations = relations(billingUsageCounters, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [billingUsageCounters.userId],
    references: [iamUsers.id],
  }),
}));

export const orgMembershipsInIamRelations = relations(iamOrgMemberships, ({ one }) => ({
  iamOrganizations: one(iamOrganizations, {
    fields: [iamOrgMemberships.orgId],
    references: [iamOrganizations.id],
  }),
  iamUsers: one(iamUsers, {
    fields: [iamOrgMemberships.userId],
    references: [iamUsers.id],
  }),
  iamClasses: one(iamClasses, {
    fields: [iamOrgMemberships.classId],
    references: [iamClasses.id],
  }),
}));

export const testSetItemsInCatalogRelations = relations(catalogTestSetItems, ({ one }) => ({
  catalogTestSets: one(catalogTestSets, {
    fields: [catalogTestSetItems.testSetId],
    references: [catalogTestSets.id],
  }),
  catalogQuestions: one(catalogQuestions, {
    fields: [catalogTestSetItems.questionId],
    references: [catalogQuestions.id],
  }),
  catalogSections: one(catalogSections, {
    fields: [catalogTestSetItems.sectionId],
    references: [catalogSections.id],
  }),
}));

export const skillMasteryInLearnRelations = relations(learnSkillMastery, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnSkillMastery.userId],
    references: [iamUsers.id],
  }),
  catalogPrograms: one(catalogPrograms, {
    fields: [learnSkillMastery.programCode],
    references: [catalogPrograms.code],
  }),
  catalogSubskills: one(catalogSubskills, {
    fields: [learnSkillMastery.subskillId],
    references: [catalogSubskills.id],
  }),
}));

export const lessonProgressInLearnRelations = relations(learnLessonProgress, ({ one }) => ({
  iamUsers: one(iamUsers, {
    fields: [learnLessonProgress.userId],
    references: [iamUsers.id],
  }),
  catalogLessons: one(catalogLessons, {
    fields: [learnLessonProgress.lessonId],
    references: [catalogLessons.id],
  }),
}));
