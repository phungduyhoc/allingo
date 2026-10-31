import { relations } from "drizzle-orm/relations";
import { usersInIam, authIdentitiesInIam, sessionsInIam, userRolesInIam, rolesInIam, referralsInIam, consentsInIam, deletionRequestsInIam, programsInCatalog, skillsInCatalog, sectionsInCatalog, topicsInCatalog, subskillsInCatalog, mediaAssetsInCatalog, passagesInCatalog, questionsInCatalog, questionTypesInCatalog, questionVersionsInCatalog, testSetsInCatalog, grammarTopicsInCatalog, lessonsInCatalog, lessonStepsInCatalog, exercisesInCatalog, videosInCatalog, videoSentencesInCatalog, vocabItemsInCatalog, vocabListsInCatalog, contentReviewsInCatalog, enrollmentsInLearn, studyPlansInLearn, planWeeksInLearn, planTasksInLearn, attemptsInLearn, recordingsInLearn, submissionsInLearn, gradingResultsInLearn, promptVersionsInAi, pronunciationScoresInLearn, phrasingFixesInLearn, errorLogEntriesInLearn, srsCardsInLearn, srsReviewsInLearn, notesInLearn, streaksInLearn, xpEventsInLearn, scoreForecastsInLearn, chatThreadsInLearn, chatMessagesInLearn, promptTemplatesInAi, explanationCacheInAi, evalSetsInAi, evalItemsInAi, evalRunsInAi, feedbackInAi, plansInBilling, pricesInBilling, ordersInBilling, organizationsInIam, promotionsInBilling, paymentsInBilling, subscriptionsInBilling, entitlementsInBilling, creditLedgerInBilling, invoicesInBilling, notificationsInOps, notificationPreferencesInOps, feedbackInOps, contentReportsInOps, supportTicketsInOps, classesInIam, assignmentsInLearn, questionSubskillsInCatalog, vocabListItemsInCatalog, userBadgesInLearn, badgesInLearn, testSetSectionsInCatalog, evalRunItemsInAi, assignmentSubmissionsInLearn, shadowingProgressInLearn, usageCountersInBilling, orgMembershipsInIam, testSetItemsInCatalog, skillMasteryInLearn, lessonProgressInLearn } from "./schema";

export const authIdentitiesInIamRelations = relations(authIdentitiesInIam, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [authIdentitiesInIam.userId],
		references: [usersInIam.id]
	}),
}));

export const usersInIamRelations = relations(usersInIam, ({many}) => ({
	authIdentitiesInIam: many(authIdentitiesInIam),
	sessionsInIam: many(sessionsInIam),
	userRolesInIam_userId: many(userRolesInIam, {
		relationName: "userRolesInIam_userId_usersInIam_id"
	}),
	userRolesInIam_grantedBy: many(userRolesInIam, {
		relationName: "userRolesInIam_grantedBy_usersInIam_id"
	}),
	referralsInIam_referrerUserId: many(referralsInIam, {
		relationName: "referralsInIam_referrerUserId_usersInIam_id"
	}),
	referralsInIam_refereeUserId: many(referralsInIam, {
		relationName: "referralsInIam_refereeUserId_usersInIam_id"
	}),
	consentsInIam: many(consentsInIam),
	deletionRequestsInIam: many(deletionRequestsInIam),
	mediaAssetsInCatalogs: many(mediaAssetsInCatalog),
	passagesInCatalogs: many(passagesInCatalog),
	questionsInCatalogs: many(questionsInCatalog),
	questionVersionsInCatalogs: many(questionVersionsInCatalog),
	videosInCatalogs: many(videosInCatalog),
	vocabListsInCatalogs: many(vocabListsInCatalog),
	contentReviewsInCatalogs: many(contentReviewsInCatalog),
	enrollmentsInLearns: many(enrollmentsInLearn),
	attemptsInLearns: many(attemptsInLearn),
	recordingsInLearns: many(recordingsInLearn),
	submissionsInLearns: many(submissionsInLearn),
	errorLogEntriesInLearns: many(errorLogEntriesInLearn),
	srsCardsInLearns: many(srsCardsInLearn),
	notesInLearns: many(notesInLearn),
	streaksInLearns: many(streaksInLearn),
	xpEventsInLearns: many(xpEventsInLearn),
	chatThreadsInLearns: many(chatThreadsInLearn),
	promptVersionsInAis: many(promptVersionsInAi),
	feedbackInAis: many(feedbackInAi),
	ordersInBillings: many(ordersInBilling),
	subscriptionsInBillings: many(subscriptionsInBilling),
	entitlementsInBillings: many(entitlementsInBilling),
	creditLedgerInBillings: many(creditLedgerInBilling),
	notificationsInOps: many(notificationsInOps),
	notificationPreferencesInOps: many(notificationPreferencesInOps),
	feedbackInOps: many(feedbackInOps),
	contentReportsInOps_userId: many(contentReportsInOps, {
		relationName: "contentReportsInOps_userId_usersInIam_id"
	}),
	contentReportsInOps_resolvedBy: many(contentReportsInOps, {
		relationName: "contentReportsInOps_resolvedBy_usersInIam_id"
	}),
	supportTicketsInOps_userId: many(supportTicketsInOps, {
		relationName: "supportTicketsInOps_userId_usersInIam_id"
	}),
	supportTicketsInOps_assignedTo: many(supportTicketsInOps, {
		relationName: "supportTicketsInOps_assignedTo_usersInIam_id"
	}),
	classesInIam: many(classesInIam),
	assignmentsInLearns: many(assignmentsInLearn),
	userBadgesInLearns: many(userBadgesInLearn),
	assignmentSubmissionsInLearns: many(assignmentSubmissionsInLearn),
	shadowingProgressInLearns: many(shadowingProgressInLearn),
	usageCountersInBillings: many(usageCountersInBilling),
	orgMembershipsInIam: many(orgMembershipsInIam),
	skillMasteryInLearns: many(skillMasteryInLearn),
	lessonProgressInLearns: many(lessonProgressInLearn),
}));

export const sessionsInIamRelations = relations(sessionsInIam, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [sessionsInIam.userId],
		references: [usersInIam.id]
	}),
}));

export const userRolesInIamRelations = relations(userRolesInIam, ({one}) => ({
	usersInIam_userId: one(usersInIam, {
		fields: [userRolesInIam.userId],
		references: [usersInIam.id],
		relationName: "userRolesInIam_userId_usersInIam_id"
	}),
	rolesInIam: one(rolesInIam, {
		fields: [userRolesInIam.roleCode],
		references: [rolesInIam.code]
	}),
	usersInIam_grantedBy: one(usersInIam, {
		fields: [userRolesInIam.grantedBy],
		references: [usersInIam.id],
		relationName: "userRolesInIam_grantedBy_usersInIam_id"
	}),
}));

export const rolesInIamRelations = relations(rolesInIam, ({many}) => ({
	userRolesInIam: many(userRolesInIam),
}));

export const referralsInIamRelations = relations(referralsInIam, ({one}) => ({
	usersInIam_referrerUserId: one(usersInIam, {
		fields: [referralsInIam.referrerUserId],
		references: [usersInIam.id],
		relationName: "referralsInIam_referrerUserId_usersInIam_id"
	}),
	usersInIam_refereeUserId: one(usersInIam, {
		fields: [referralsInIam.refereeUserId],
		references: [usersInIam.id],
		relationName: "referralsInIam_refereeUserId_usersInIam_id"
	}),
}));

export const consentsInIamRelations = relations(consentsInIam, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [consentsInIam.userId],
		references: [usersInIam.id]
	}),
}));

export const deletionRequestsInIamRelations = relations(deletionRequestsInIam, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [deletionRequestsInIam.userId],
		references: [usersInIam.id]
	}),
}));

export const skillsInCatalogRelations = relations(skillsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [skillsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	sectionsInCatalogs: many(sectionsInCatalog),
	subskillsInCatalogs: many(subskillsInCatalog),
	lessonsInCatalogs: many(lessonsInCatalog),
	planWeeksInLearns: many(planWeeksInLearn),
}));

export const programsInCatalogRelations = relations(programsInCatalog, ({many}) => ({
	skillsInCatalogs: many(skillsInCatalog),
	sectionsInCatalogs: many(sectionsInCatalog),
	topicsInCatalogs: many(topicsInCatalog),
	subskillsInCatalogs: many(subskillsInCatalog),
	passagesInCatalogs: many(passagesInCatalog),
	questionsInCatalogs: many(questionsInCatalog),
	testSetsInCatalogs: many(testSetsInCatalog),
	grammarTopicsInCatalogs: many(grammarTopicsInCatalog),
	lessonsInCatalogs: many(lessonsInCatalog),
	exercisesInCatalogs: many(exercisesInCatalog),
	videosInCatalogs: many(videosInCatalog),
	vocabItemsInCatalogs: many(vocabItemsInCatalog),
	vocabListsInCatalogs: many(vocabListsInCatalog),
	enrollmentsInLearns: many(enrollmentsInLearn),
	attemptsInLearns: many(attemptsInLearn),
	submissionsInLearns: many(submissionsInLearn),
	errorLogEntriesInLearns: many(errorLogEntriesInLearn),
	srsCardsInLearns: many(srsCardsInLearn),
	chatThreadsInLearns: many(chatThreadsInLearn),
	promptTemplatesInAis: many(promptTemplatesInAi),
	evalSetsInAis: many(evalSetsInAi),
	subscriptionsInBillings: many(subscriptionsInBilling),
	entitlementsInBillings: many(entitlementsInBilling),
	skillMasteryInLearns: many(skillMasteryInLearn),
}));

export const sectionsInCatalogRelations = relations(sectionsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [sectionsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	skillsInCatalog: one(skillsInCatalog, {
		fields: [sectionsInCatalog.skillId],
		references: [skillsInCatalog.id]
	}),
	questionsInCatalogs: many(questionsInCatalog),
	lessonsInCatalogs: many(lessonsInCatalog),
	planWeeksInLearns: many(planWeeksInLearn),
	attemptsInLearns: many(attemptsInLearn),
	testSetSectionsInCatalogs: many(testSetSectionsInCatalog),
	testSetItemsInCatalogs: many(testSetItemsInCatalog),
}));

export const topicsInCatalogRelations = relations(topicsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [topicsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	passagesInCatalogs: many(passagesInCatalog),
	questionsInCatalogs: many(questionsInCatalog),
	vocabListsInCatalogs: many(vocabListsInCatalog),
}));

export const subskillsInCatalogRelations = relations(subskillsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [subskillsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	skillsInCatalog: one(skillsInCatalog, {
		fields: [subskillsInCatalog.skillId],
		references: [skillsInCatalog.id]
	}),
	errorLogEntriesInLearns: many(errorLogEntriesInLearn),
	questionSubskillsInCatalogs: many(questionSubskillsInCatalog),
	skillMasteryInLearns: many(skillMasteryInLearn),
}));

export const mediaAssetsInCatalogRelations = relations(mediaAssetsInCatalog, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [mediaAssetsInCatalog.createdBy],
		references: [usersInIam.id]
	}),
	passagesInCatalogs: many(passagesInCatalog),
	vocabItemsInCatalogs_audioUkId: many(vocabItemsInCatalog, {
		relationName: "vocabItemsInCatalog_audioUkId_mediaAssetsInCatalog_id"
	}),
	vocabItemsInCatalogs_audioUsId: many(vocabItemsInCatalog, {
		relationName: "vocabItemsInCatalog_audioUsId_mediaAssetsInCatalog_id"
	}),
	submissionsInLearns: many(submissionsInLearn),
}));

export const passagesInCatalogRelations = relations(passagesInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [passagesInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	mediaAssetsInCatalog: one(mediaAssetsInCatalog, {
		fields: [passagesInCatalog.mediaAssetId],
		references: [mediaAssetsInCatalog.id]
	}),
	topicsInCatalog: one(topicsInCatalog, {
		fields: [passagesInCatalog.topicId],
		references: [topicsInCatalog.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [passagesInCatalog.createdBy],
		references: [usersInIam.id]
	}),
	questionsInCatalogs: many(questionsInCatalog),
}));

export const questionsInCatalogRelations = relations(questionsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [questionsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	sectionsInCatalog: one(sectionsInCatalog, {
		fields: [questionsInCatalog.sectionId],
		references: [sectionsInCatalog.id]
	}),
	questionTypesInCatalog: one(questionTypesInCatalog, {
		fields: [questionsInCatalog.questionTypeCode],
		references: [questionTypesInCatalog.code]
	}),
	passagesInCatalog: one(passagesInCatalog, {
		fields: [questionsInCatalog.passageId],
		references: [passagesInCatalog.id]
	}),
	topicsInCatalog: one(topicsInCatalog, {
		fields: [questionsInCatalog.topicId],
		references: [topicsInCatalog.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [questionsInCatalog.createdBy],
		references: [usersInIam.id]
	}),
	questionVersionsInCatalog: one(questionVersionsInCatalog, {
		fields: [questionsInCatalog.currentVersionId],
		references: [questionVersionsInCatalog.id],
		relationName: "questionsInCatalog_currentVersionId_questionVersionsInCatalog_id"
	}),
	questionVersionsInCatalogs: many(questionVersionsInCatalog, {
		relationName: "questionVersionsInCatalog_questionId_questionsInCatalog_id"
	}),
	errorLogEntriesInLearns: many(errorLogEntriesInLearn),
	notesInLearns: many(notesInLearn),
	questionSubskillsInCatalogs: many(questionSubskillsInCatalog),
	testSetItemsInCatalogs: many(testSetItemsInCatalog),
}));

export const questionTypesInCatalogRelations = relations(questionTypesInCatalog, ({many}) => ({
	questionsInCatalogs: many(questionsInCatalog),
}));

export const questionVersionsInCatalogRelations = relations(questionVersionsInCatalog, ({one, many}) => ({
	questionsInCatalogs: many(questionsInCatalog, {
		relationName: "questionsInCatalog_currentVersionId_questionVersionsInCatalog_id"
	}),
	questionsInCatalog: one(questionsInCatalog, {
		fields: [questionVersionsInCatalog.questionId],
		references: [questionsInCatalog.id],
		relationName: "questionVersionsInCatalog_questionId_questionsInCatalog_id"
	}),
	usersInIam: one(usersInIam, {
		fields: [questionVersionsInCatalog.createdBy],
		references: [usersInIam.id]
	}),
	explanationCacheInAis: many(explanationCacheInAi),
}));

export const testSetsInCatalogRelations = relations(testSetsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [testSetsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	vocabListsInCatalogs: many(vocabListsInCatalog),
	attemptsInLearns: many(attemptsInLearn),
	notesInLearns: many(notesInLearn),
	testSetSectionsInCatalogs: many(testSetSectionsInCatalog),
	testSetItemsInCatalogs: many(testSetItemsInCatalog),
}));

export const grammarTopicsInCatalogRelations = relations(grammarTopicsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [grammarTopicsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	lessonsInCatalogs: many(lessonsInCatalog),
	exercisesInCatalogs: many(exercisesInCatalog),
}));

export const lessonsInCatalogRelations = relations(lessonsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [lessonsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	skillsInCatalog: one(skillsInCatalog, {
		fields: [lessonsInCatalog.skillId],
		references: [skillsInCatalog.id]
	}),
	sectionsInCatalog: one(sectionsInCatalog, {
		fields: [lessonsInCatalog.sectionId],
		references: [sectionsInCatalog.id]
	}),
	grammarTopicsInCatalog: one(grammarTopicsInCatalog, {
		fields: [lessonsInCatalog.grammarTopicId],
		references: [grammarTopicsInCatalog.id]
	}),
	lessonStepsInCatalogs: many(lessonStepsInCatalog),
	exercisesInCatalogs: many(exercisesInCatalog),
	lessonProgressInLearns: many(lessonProgressInLearn),
}));

export const lessonStepsInCatalogRelations = relations(lessonStepsInCatalog, ({one}) => ({
	lessonsInCatalog: one(lessonsInCatalog, {
		fields: [lessonStepsInCatalog.lessonId],
		references: [lessonsInCatalog.id]
	}),
}));

export const exercisesInCatalogRelations = relations(exercisesInCatalog, ({one}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [exercisesInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	lessonsInCatalog: one(lessonsInCatalog, {
		fields: [exercisesInCatalog.lessonId],
		references: [lessonsInCatalog.id]
	}),
	grammarTopicsInCatalog: one(grammarTopicsInCatalog, {
		fields: [exercisesInCatalog.grammarTopicId],
		references: [grammarTopicsInCatalog.id]
	}),
}));

export const videosInCatalogRelations = relations(videosInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [videosInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	usersInIam: one(usersInIam, {
		fields: [videosInCatalog.submittedBy],
		references: [usersInIam.id]
	}),
	videoSentencesInCatalogs: many(videoSentencesInCatalog),
	shadowingProgressInLearns: many(shadowingProgressInLearn),
}));

export const videoSentencesInCatalogRelations = relations(videoSentencesInCatalog, ({one}) => ({
	videosInCatalog: one(videosInCatalog, {
		fields: [videoSentencesInCatalog.videoId],
		references: [videosInCatalog.id]
	}),
}));

export const vocabItemsInCatalogRelations = relations(vocabItemsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [vocabItemsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	mediaAssetsInCatalog_audioUkId: one(mediaAssetsInCatalog, {
		fields: [vocabItemsInCatalog.audioUkId],
		references: [mediaAssetsInCatalog.id],
		relationName: "vocabItemsInCatalog_audioUkId_mediaAssetsInCatalog_id"
	}),
	mediaAssetsInCatalog_audioUsId: one(mediaAssetsInCatalog, {
		fields: [vocabItemsInCatalog.audioUsId],
		references: [mediaAssetsInCatalog.id],
		relationName: "vocabItemsInCatalog_audioUsId_mediaAssetsInCatalog_id"
	}),
	vocabListItemsInCatalogs: many(vocabListItemsInCatalog),
}));

export const vocabListsInCatalogRelations = relations(vocabListsInCatalog, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [vocabListsInCatalog.programCode],
		references: [programsInCatalog.code]
	}),
	testSetsInCatalog: one(testSetsInCatalog, {
		fields: [vocabListsInCatalog.testSetId],
		references: [testSetsInCatalog.id]
	}),
	topicsInCatalog: one(topicsInCatalog, {
		fields: [vocabListsInCatalog.topicId],
		references: [topicsInCatalog.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [vocabListsInCatalog.ownerUserId],
		references: [usersInIam.id]
	}),
	vocabListItemsInCatalogs: many(vocabListItemsInCatalog),
}));

export const contentReviewsInCatalogRelations = relations(contentReviewsInCatalog, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [contentReviewsInCatalog.reviewerId],
		references: [usersInIam.id]
	}),
}));

export const enrollmentsInLearnRelations = relations(enrollmentsInLearn, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [enrollmentsInLearn.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [enrollmentsInLearn.programCode],
		references: [programsInCatalog.code]
	}),
	studyPlansInLearns: many(studyPlansInLearn),
	scoreForecastsInLearns: many(scoreForecastsInLearn),
}));

export const studyPlansInLearnRelations = relations(studyPlansInLearn, ({one, many}) => ({
	enrollmentsInLearn: one(enrollmentsInLearn, {
		fields: [studyPlansInLearn.enrollmentId],
		references: [enrollmentsInLearn.id]
	}),
	planWeeksInLearns: many(planWeeksInLearn),
}));

export const planWeeksInLearnRelations = relations(planWeeksInLearn, ({one, many}) => ({
	studyPlansInLearn: one(studyPlansInLearn, {
		fields: [planWeeksInLearn.planId],
		references: [studyPlansInLearn.id]
	}),
	skillsInCatalog: one(skillsInCatalog, {
		fields: [planWeeksInLearn.focusSkillId],
		references: [skillsInCatalog.id]
	}),
	sectionsInCatalog: one(sectionsInCatalog, {
		fields: [planWeeksInLearn.focusSectionId],
		references: [sectionsInCatalog.id]
	}),
	planTasksInLearns: many(planTasksInLearn),
}));

export const planTasksInLearnRelations = relations(planTasksInLearn, ({one, many}) => ({
	planWeeksInLearn: one(planWeeksInLearn, {
		fields: [planTasksInLearn.planWeekId],
		references: [planWeeksInLearn.id]
	}),
	attemptsInLearns: many(attemptsInLearn),
}));

export const attemptsInLearnRelations = relations(attemptsInLearn, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [attemptsInLearn.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [attemptsInLearn.programCode],
		references: [programsInCatalog.code]
	}),
	testSetsInCatalog: one(testSetsInCatalog, {
		fields: [attemptsInLearn.testSetId],
		references: [testSetsInCatalog.id]
	}),
	sectionsInCatalog: one(sectionsInCatalog, {
		fields: [attemptsInLearn.sectionId],
		references: [sectionsInCatalog.id]
	}),
	planTasksInLearn: one(planTasksInLearn, {
		fields: [attemptsInLearn.planTaskId],
		references: [planTasksInLearn.id]
	}),
	submissionsInLearns: many(submissionsInLearn),
}));

export const recordingsInLearnRelations = relations(recordingsInLearn, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [recordingsInLearn.userId],
		references: [usersInIam.id]
	}),
	submissionsInLearns: many(submissionsInLearn),
}));

export const submissionsInLearnRelations = relations(submissionsInLearn, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [submissionsInLearn.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [submissionsInLearn.programCode],
		references: [programsInCatalog.code]
	}),
	attemptsInLearn: one(attemptsInLearn, {
		fields: [submissionsInLearn.attemptId],
		references: [attemptsInLearn.id]
	}),
	submissionsInLearn: one(submissionsInLearn, {
		fields: [submissionsInLearn.parentSubmissionId],
		references: [submissionsInLearn.id],
		relationName: "submissionsInLearn_parentSubmissionId_submissionsInLearn_id"
	}),
	submissionsInLearns: many(submissionsInLearn, {
		relationName: "submissionsInLearn_parentSubmissionId_submissionsInLearn_id"
	}),
	recordingsInLearn: one(recordingsInLearn, {
		fields: [submissionsInLearn.recordingId],
		references: [recordingsInLearn.id]
	}),
	mediaAssetsInCatalog: one(mediaAssetsInCatalog, {
		fields: [submissionsInLearn.attachmentId],
		references: [mediaAssetsInCatalog.id]
	}),
	gradingResultsInLearns: many(gradingResultsInLearn),
	pronunciationScoresInLearns: many(pronunciationScoresInLearn),
	errorLogEntriesInLearns: many(errorLogEntriesInLearn),
}));

export const gradingResultsInLearnRelations = relations(gradingResultsInLearn, ({one, many}) => ({
	submissionsInLearn: one(submissionsInLearn, {
		fields: [gradingResultsInLearn.submissionId],
		references: [submissionsInLearn.id]
	}),
	promptVersionsInAi: one(promptVersionsInAi, {
		fields: [gradingResultsInLearn.promptVersionId],
		references: [promptVersionsInAi.id]
	}),
	phrasingFixesInLearns: many(phrasingFixesInLearn),
}));

export const promptVersionsInAiRelations = relations(promptVersionsInAi, ({one, many}) => ({
	gradingResultsInLearns: many(gradingResultsInLearn),
	promptTemplatesInAi: one(promptTemplatesInAi, {
		fields: [promptVersionsInAi.templateId],
		references: [promptTemplatesInAi.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [promptVersionsInAi.createdBy],
		references: [usersInIam.id]
	}),
	explanationCacheInAis: many(explanationCacheInAi),
	evalRunsInAis: many(evalRunsInAi),
}));

export const pronunciationScoresInLearnRelations = relations(pronunciationScoresInLearn, ({one}) => ({
	submissionsInLearn: one(submissionsInLearn, {
		fields: [pronunciationScoresInLearn.submissionId],
		references: [submissionsInLearn.id]
	}),
}));

export const phrasingFixesInLearnRelations = relations(phrasingFixesInLearn, ({one}) => ({
	gradingResultsInLearn: one(gradingResultsInLearn, {
		fields: [phrasingFixesInLearn.gradingResultId],
		references: [gradingResultsInLearn.id]
	}),
}));

export const errorLogEntriesInLearnRelations = relations(errorLogEntriesInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [errorLogEntriesInLearn.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [errorLogEntriesInLearn.programCode],
		references: [programsInCatalog.code]
	}),
	submissionsInLearn: one(submissionsInLearn, {
		fields: [errorLogEntriesInLearn.submissionId],
		references: [submissionsInLearn.id]
	}),
	questionsInCatalog: one(questionsInCatalog, {
		fields: [errorLogEntriesInLearn.questionId],
		references: [questionsInCatalog.id]
	}),
	subskillsInCatalog: one(subskillsInCatalog, {
		fields: [errorLogEntriesInLearn.subskillId],
		references: [subskillsInCatalog.id]
	}),
}));

export const srsCardsInLearnRelations = relations(srsCardsInLearn, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [srsCardsInLearn.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [srsCardsInLearn.programCode],
		references: [programsInCatalog.code]
	}),
	srsReviewsInLearns: many(srsReviewsInLearn),
}));

export const srsReviewsInLearnRelations = relations(srsReviewsInLearn, ({one}) => ({
	srsCardsInLearn: one(srsCardsInLearn, {
		fields: [srsReviewsInLearn.cardId],
		references: [srsCardsInLearn.id]
	}),
}));

export const notesInLearnRelations = relations(notesInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [notesInLearn.userId],
		references: [usersInIam.id]
	}),
	testSetsInCatalog: one(testSetsInCatalog, {
		fields: [notesInLearn.testSetId],
		references: [testSetsInCatalog.id]
	}),
	questionsInCatalog: one(questionsInCatalog, {
		fields: [notesInLearn.questionId],
		references: [questionsInCatalog.id]
	}),
}));

export const streaksInLearnRelations = relations(streaksInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [streaksInLearn.userId],
		references: [usersInIam.id]
	}),
}));

export const xpEventsInLearnRelations = relations(xpEventsInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [xpEventsInLearn.userId],
		references: [usersInIam.id]
	}),
}));

export const scoreForecastsInLearnRelations = relations(scoreForecastsInLearn, ({one}) => ({
	enrollmentsInLearn: one(enrollmentsInLearn, {
		fields: [scoreForecastsInLearn.enrollmentId],
		references: [enrollmentsInLearn.id]
	}),
}));

export const chatThreadsInLearnRelations = relations(chatThreadsInLearn, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [chatThreadsInLearn.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [chatThreadsInLearn.programCode],
		references: [programsInCatalog.code]
	}),
	chatMessagesInLearns: many(chatMessagesInLearn),
}));

export const chatMessagesInLearnRelations = relations(chatMessagesInLearn, ({one}) => ({
	chatThreadsInLearn: one(chatThreadsInLearn, {
		fields: [chatMessagesInLearn.threadId],
		references: [chatThreadsInLearn.id]
	}),
}));

export const promptTemplatesInAiRelations = relations(promptTemplatesInAi, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [promptTemplatesInAi.programCode],
		references: [programsInCatalog.code]
	}),
	promptVersionsInAis: many(promptVersionsInAi),
}));

export const explanationCacheInAiRelations = relations(explanationCacheInAi, ({one}) => ({
	questionVersionsInCatalog: one(questionVersionsInCatalog, {
		fields: [explanationCacheInAi.questionVersionId],
		references: [questionVersionsInCatalog.id]
	}),
	promptVersionsInAi: one(promptVersionsInAi, {
		fields: [explanationCacheInAi.promptVersionId],
		references: [promptVersionsInAi.id]
	}),
}));

export const evalSetsInAiRelations = relations(evalSetsInAi, ({one, many}) => ({
	programsInCatalog: one(programsInCatalog, {
		fields: [evalSetsInAi.programCode],
		references: [programsInCatalog.code]
	}),
	evalItemsInAis: many(evalItemsInAi),
	evalRunsInAis: many(evalRunsInAi),
}));

export const evalItemsInAiRelations = relations(evalItemsInAi, ({one, many}) => ({
	evalSetsInAi: one(evalSetsInAi, {
		fields: [evalItemsInAi.evalSetId],
		references: [evalSetsInAi.id]
	}),
	evalRunItemsInAis: many(evalRunItemsInAi),
}));

export const evalRunsInAiRelations = relations(evalRunsInAi, ({one, many}) => ({
	evalSetsInAi: one(evalSetsInAi, {
		fields: [evalRunsInAi.evalSetId],
		references: [evalSetsInAi.id]
	}),
	promptVersionsInAi: one(promptVersionsInAi, {
		fields: [evalRunsInAi.promptVersionId],
		references: [promptVersionsInAi.id]
	}),
	evalRunItemsInAis: many(evalRunItemsInAi),
}));

export const feedbackInAiRelations = relations(feedbackInAi, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [feedbackInAi.userId],
		references: [usersInIam.id]
	}),
}));

export const pricesInBillingRelations = relations(pricesInBilling, ({one, many}) => ({
	plansInBilling: one(plansInBilling, {
		fields: [pricesInBilling.planId],
		references: [plansInBilling.id]
	}),
	ordersInBillings: many(ordersInBilling),
}));

export const plansInBillingRelations = relations(plansInBilling, ({many}) => ({
	pricesInBillings: many(pricesInBilling),
	ordersInBillings: many(ordersInBilling),
	subscriptionsInBillings: many(subscriptionsInBilling),
}));

export const ordersInBillingRelations = relations(ordersInBilling, ({one, many}) => ({
	usersInIam: one(usersInIam, {
		fields: [ordersInBilling.userId],
		references: [usersInIam.id]
	}),
	organizationsInIam: one(organizationsInIam, {
		fields: [ordersInBilling.orgId],
		references: [organizationsInIam.id]
	}),
	plansInBilling: one(plansInBilling, {
		fields: [ordersInBilling.planId],
		references: [plansInBilling.id]
	}),
	pricesInBilling: one(pricesInBilling, {
		fields: [ordersInBilling.priceId],
		references: [pricesInBilling.id]
	}),
	promotionsInBilling: one(promotionsInBilling, {
		fields: [ordersInBilling.promotionId],
		references: [promotionsInBilling.id]
	}),
	paymentsInBillings: many(paymentsInBilling),
	subscriptionsInBillings: many(subscriptionsInBilling),
	invoicesInBillings: many(invoicesInBilling),
}));

export const organizationsInIamRelations = relations(organizationsInIam, ({many}) => ({
	ordersInBillings: many(ordersInBilling),
	subscriptionsInBillings: many(subscriptionsInBilling),
	creditLedgerInBillings: many(creditLedgerInBilling),
	classesInIam: many(classesInIam),
	assignmentsInLearns: many(assignmentsInLearn),
	orgMembershipsInIam: many(orgMembershipsInIam),
}));

export const promotionsInBillingRelations = relations(promotionsInBilling, ({many}) => ({
	ordersInBillings: many(ordersInBilling),
}));

export const paymentsInBillingRelations = relations(paymentsInBilling, ({one}) => ({
	ordersInBilling: one(ordersInBilling, {
		fields: [paymentsInBilling.orderId],
		references: [ordersInBilling.id]
	}),
}));

export const subscriptionsInBillingRelations = relations(subscriptionsInBilling, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [subscriptionsInBilling.userId],
		references: [usersInIam.id]
	}),
	organizationsInIam: one(organizationsInIam, {
		fields: [subscriptionsInBilling.orgId],
		references: [organizationsInIam.id]
	}),
	plansInBilling: one(plansInBilling, {
		fields: [subscriptionsInBilling.planId],
		references: [plansInBilling.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [subscriptionsInBilling.programCode],
		references: [programsInCatalog.code]
	}),
	ordersInBilling: one(ordersInBilling, {
		fields: [subscriptionsInBilling.sourceOrderId],
		references: [ordersInBilling.id]
	}),
}));

export const entitlementsInBillingRelations = relations(entitlementsInBilling, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [entitlementsInBilling.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [entitlementsInBilling.programCode],
		references: [programsInCatalog.code]
	}),
}));

export const creditLedgerInBillingRelations = relations(creditLedgerInBilling, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [creditLedgerInBilling.userId],
		references: [usersInIam.id]
	}),
	organizationsInIam: one(organizationsInIam, {
		fields: [creditLedgerInBilling.orgId],
		references: [organizationsInIam.id]
	}),
}));

export const invoicesInBillingRelations = relations(invoicesInBilling, ({one}) => ({
	ordersInBilling: one(ordersInBilling, {
		fields: [invoicesInBilling.orderId],
		references: [ordersInBilling.id]
	}),
}));

export const notificationsInOpsRelations = relations(notificationsInOps, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [notificationsInOps.userId],
		references: [usersInIam.id]
	}),
}));

export const notificationPreferencesInOpsRelations = relations(notificationPreferencesInOps, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [notificationPreferencesInOps.userId],
		references: [usersInIam.id]
	}),
}));

export const feedbackInOpsRelations = relations(feedbackInOps, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [feedbackInOps.userId],
		references: [usersInIam.id]
	}),
}));

export const contentReportsInOpsRelations = relations(contentReportsInOps, ({one}) => ({
	usersInIam_userId: one(usersInIam, {
		fields: [contentReportsInOps.userId],
		references: [usersInIam.id],
		relationName: "contentReportsInOps_userId_usersInIam_id"
	}),
	usersInIam_resolvedBy: one(usersInIam, {
		fields: [contentReportsInOps.resolvedBy],
		references: [usersInIam.id],
		relationName: "contentReportsInOps_resolvedBy_usersInIam_id"
	}),
}));

export const supportTicketsInOpsRelations = relations(supportTicketsInOps, ({one}) => ({
	usersInIam_userId: one(usersInIam, {
		fields: [supportTicketsInOps.userId],
		references: [usersInIam.id],
		relationName: "supportTicketsInOps_userId_usersInIam_id"
	}),
	usersInIam_assignedTo: one(usersInIam, {
		fields: [supportTicketsInOps.assignedTo],
		references: [usersInIam.id],
		relationName: "supportTicketsInOps_assignedTo_usersInIam_id"
	}),
}));

export const classesInIamRelations = relations(classesInIam, ({one, many}) => ({
	organizationsInIam: one(organizationsInIam, {
		fields: [classesInIam.orgId],
		references: [organizationsInIam.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [classesInIam.teacherUserId],
		references: [usersInIam.id]
	}),
	assignmentsInLearns: many(assignmentsInLearn),
	orgMembershipsInIam: many(orgMembershipsInIam),
}));

export const assignmentsInLearnRelations = relations(assignmentsInLearn, ({one, many}) => ({
	organizationsInIam: one(organizationsInIam, {
		fields: [assignmentsInLearn.orgId],
		references: [organizationsInIam.id]
	}),
	classesInIam: one(classesInIam, {
		fields: [assignmentsInLearn.classId],
		references: [classesInIam.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [assignmentsInLearn.createdBy],
		references: [usersInIam.id]
	}),
	assignmentSubmissionsInLearns: many(assignmentSubmissionsInLearn),
}));

export const questionSubskillsInCatalogRelations = relations(questionSubskillsInCatalog, ({one}) => ({
	questionsInCatalog: one(questionsInCatalog, {
		fields: [questionSubskillsInCatalog.questionId],
		references: [questionsInCatalog.id]
	}),
	subskillsInCatalog: one(subskillsInCatalog, {
		fields: [questionSubskillsInCatalog.subskillId],
		references: [subskillsInCatalog.id]
	}),
}));

export const vocabListItemsInCatalogRelations = relations(vocabListItemsInCatalog, ({one}) => ({
	vocabListsInCatalog: one(vocabListsInCatalog, {
		fields: [vocabListItemsInCatalog.listId],
		references: [vocabListsInCatalog.id]
	}),
	vocabItemsInCatalog: one(vocabItemsInCatalog, {
		fields: [vocabListItemsInCatalog.vocabItemId],
		references: [vocabItemsInCatalog.id]
	}),
}));

export const userBadgesInLearnRelations = relations(userBadgesInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [userBadgesInLearn.userId],
		references: [usersInIam.id]
	}),
	badgesInLearn: one(badgesInLearn, {
		fields: [userBadgesInLearn.badgeCode],
		references: [badgesInLearn.code]
	}),
}));

export const badgesInLearnRelations = relations(badgesInLearn, ({many}) => ({
	userBadgesInLearns: many(userBadgesInLearn),
}));

export const testSetSectionsInCatalogRelations = relations(testSetSectionsInCatalog, ({one}) => ({
	testSetsInCatalog: one(testSetsInCatalog, {
		fields: [testSetSectionsInCatalog.testSetId],
		references: [testSetsInCatalog.id]
	}),
	sectionsInCatalog: one(sectionsInCatalog, {
		fields: [testSetSectionsInCatalog.sectionId],
		references: [sectionsInCatalog.id]
	}),
}));

export const evalRunItemsInAiRelations = relations(evalRunItemsInAi, ({one}) => ({
	evalRunsInAi: one(evalRunsInAi, {
		fields: [evalRunItemsInAi.runId],
		references: [evalRunsInAi.id]
	}),
	evalItemsInAi: one(evalItemsInAi, {
		fields: [evalRunItemsInAi.evalItemId],
		references: [evalItemsInAi.id]
	}),
}));

export const assignmentSubmissionsInLearnRelations = relations(assignmentSubmissionsInLearn, ({one}) => ({
	assignmentsInLearn: one(assignmentsInLearn, {
		fields: [assignmentSubmissionsInLearn.assignmentId],
		references: [assignmentsInLearn.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [assignmentSubmissionsInLearn.userId],
		references: [usersInIam.id]
	}),
}));

export const shadowingProgressInLearnRelations = relations(shadowingProgressInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [shadowingProgressInLearn.userId],
		references: [usersInIam.id]
	}),
	videosInCatalog: one(videosInCatalog, {
		fields: [shadowingProgressInLearn.videoId],
		references: [videosInCatalog.id]
	}),
}));

export const usageCountersInBillingRelations = relations(usageCountersInBilling, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [usageCountersInBilling.userId],
		references: [usersInIam.id]
	}),
}));

export const orgMembershipsInIamRelations = relations(orgMembershipsInIam, ({one}) => ({
	organizationsInIam: one(organizationsInIam, {
		fields: [orgMembershipsInIam.orgId],
		references: [organizationsInIam.id]
	}),
	usersInIam: one(usersInIam, {
		fields: [orgMembershipsInIam.userId],
		references: [usersInIam.id]
	}),
	classesInIam: one(classesInIam, {
		fields: [orgMembershipsInIam.classId],
		references: [classesInIam.id]
	}),
}));

export const testSetItemsInCatalogRelations = relations(testSetItemsInCatalog, ({one}) => ({
	testSetsInCatalog: one(testSetsInCatalog, {
		fields: [testSetItemsInCatalog.testSetId],
		references: [testSetsInCatalog.id]
	}),
	questionsInCatalog: one(questionsInCatalog, {
		fields: [testSetItemsInCatalog.questionId],
		references: [questionsInCatalog.id]
	}),
	sectionsInCatalog: one(sectionsInCatalog, {
		fields: [testSetItemsInCatalog.sectionId],
		references: [sectionsInCatalog.id]
	}),
}));

export const skillMasteryInLearnRelations = relations(skillMasteryInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [skillMasteryInLearn.userId],
		references: [usersInIam.id]
	}),
	programsInCatalog: one(programsInCatalog, {
		fields: [skillMasteryInLearn.programCode],
		references: [programsInCatalog.code]
	}),
	subskillsInCatalog: one(subskillsInCatalog, {
		fields: [skillMasteryInLearn.subskillId],
		references: [subskillsInCatalog.id]
	}),
}));

export const lessonProgressInLearnRelations = relations(lessonProgressInLearn, ({one}) => ({
	usersInIam: one(usersInIam, {
		fields: [lessonProgressInLearn.userId],
		references: [usersInIam.id]
	}),
	lessonsInCatalog: one(lessonsInCatalog, {
		fields: [lessonProgressInLearn.lessonId],
		references: [lessonsInCatalog.id]
	}),
}));