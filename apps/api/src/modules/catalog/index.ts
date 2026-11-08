// Giao diện công khai của module catalog
export { CatalogModule } from './catalog.module.js';
export { CatalogQueryService, assetIdsOfContent, normalizeTranscript, type LoadedQuestion, type SectionRow, type PracticeHistory, type RandomQuestionFilter, type BankRow, type MediaUrl } from './catalog-query.service.js';
export { ContentPublishService } from './content-publish.service.js';
export { ContentWorkflowService } from './content-workflow.service.js';
export { SearchService } from './search/search.service.js';
export { buildQuestionDoc, type QuestionSearchDoc } from './search/question-doc.js';
export { MiniTestService, generateTestSetInputSchema, generateTestSetResultSchema, type GenerateTestSetInput, type GenerateTestSetResult } from './mini-test.service.js';
export { ContentGenerationService, generateQuestionsInputSchema, dedupText, type GenerateQuestionsInput, type GeneratedItemResult } from './content-generation.service.js';
export { DictionaryService, translationCacheKey, type LookupInput, type LookupResult } from './dictionary.service.js';
// S12
export { ContentReportsService } from './content-reports.service.js';
export { QuestionStatsService, type QuestionStatsValue, type QuestionRecommendation } from './question-stats.service.js';
// B2/B5
export { ContentDedupService, dedupKeyText, type DuplicateFlag } from './content-dedup.service.js';
export { ContentPassageService, mergePartsBody } from './content-passage.service.js';
export { ContentReviewQueueService } from './content-review-queue.service.js';
export { ContentImportService, XLSX_MIME, type ImportReport } from './content-import.service.js';
export { ContentDraftTestService, buildDraftPlan, groupSizesOf } from './content-draft-test.service.js';
export { readXlsx, writeXlsx, zip, unzip } from './import/xlsx.js';
