# Tham chiếu nhanh cột theo bảng (sinh từ DB sau migration 0001; '!' = NOT NULL)

## iam

- `iam.auth_identities`: id:uuid!, user_id:uuid!, provider:auth_provider!, provider_uid:text!, email:citext, raw_profile:jsonb, created_at:tstz!
- `iam.classes`: id:uuid!, org_id:uuid!, name:text!, program_code:text, teacher_user_id:uuid, created_at:tstz!
- `iam.consents`: id:uuid!, user_id:uuid!, type:consent_type!, version:text!, granted_at:tstz!, revoked_at:tstz, ip:inet
- `iam.deletion_requests`: id:uuid!, user_id:uuid!, requested_at:tstz!, due_at:tstz!, completed_at:tstz, export_url:text
- `iam.org_memberships`: org_id:uuid!, user_id:uuid!, role:org_role!, class_id:uuid, joined_at:tstz!
- `iam.organizations`: id:uuid!, name:text!, type:org_type!, tax_code:text, domain:text, settings:jsonb!, status:text!, created_at:tstz!, updated_at:tstz!
- `iam.referrals`: id:uuid!, referrer_user_id:uuid!, referee_user_id:uuid, code:text!, status:referral_status!, device_fingerprint:text, ip:inet, credited_join_at:tstz, credited_upgrade_at:tstz, created_at:tstz!
- `iam.roles`: code:text!, description:text
- `iam.sessions`: id:uuid!, user_id:uuid!, refresh_token_hash:text!, device:jsonb, ip:inet, expires_at:tstz!, revoked_at:tstz, created_at:tstz!, last_seen_at:tstz
- `iam.user_roles`: user_id:uuid!, role_code:text!, program_code:text, granted_by:uuid, granted_at:tstz!
- `iam.users`: id:uuid!, email:citext, phone:text, password_hash:text, display_name:text!, avatar_url:text, ui_locale:text!, explain_locale:text!, timezone:text!, status:user_status!, is_guest:boolean!, birth_year:smallint, created_at:tstz!, updated_at:tstz!, deleted_at:tstz

## catalog

- `catalog.content_reviews`: id:uuid!, entity_type:text!, entity_id:uuid!, stage:review_stage!, reviewer_id:uuid, decision:review_decision!, notes:text, ai_report:jsonb, created_at:tstz!
- `catalog.exercises`: id:uuid!, program_code:text!, lesson_id:uuid, grammar_topic_id:uuid, exercise_type:text!, content:jsonb!, answer:jsonb!, difficulty:difficulty, status:content_status!, created_at:tstz!
- `catalog.grammar_topics`: id:uuid!, program_code:text!, code:text!, name:jsonb!, level:text, sort_order:smallint!
- `catalog.lesson_steps`: id:uuid!, lesson_id:uuid!, sort_order:smallint!, step_type:text!, content:jsonb!
- `catalog.lessons`: id:uuid!, program_code:text!, skill_id:uuid, section_id:uuid, grammar_topic_id:uuid, kind:lesson_kind!, level:text, title:jsonb!, summary:jsonb, est_minutes:smallint, is_free:boolean!, sort_order:smallint!, status:content_status!, source:content_source!, created_at:tstz!, updated_at:tstz!
- `catalog.media_assets`: id:uuid!, kind:media_kind!, storage_key:text, external_url:text, mime_type:text, duration_ms:integer, width:integer, height:integer, size_bytes:bigint, license:text!, transcript:jsonb, checksum:text, created_by:uuid, created_at:tstz!
- `catalog.passages`: id:uuid!, program_code:text!, kind:passage_kind!, title:text, body:text, media_asset_id:uuid, word_count:integer, difficulty:difficulty, topic_id:uuid, source:content_source!, status:content_status!, created_by:uuid, created_at:tstz!, updated_at:tstz!
- `catalog.programs`: code:text!, name:jsonb!, score_scale:jsonb!, languages:_text!, is_active:boolean!, sort_order:smallint!
- `catalog.question_subskills`: question_id:uuid!, subskill_id:uuid!, weight:numeric!
- `catalog.question_types`: code:text!, name:jsonb!, content_schema:jsonb!, auto_gradable:boolean!
- `catalog.question_versions`: id:uuid!, question_id:uuid!, version_no:integer!, content:jsonb!, metadata:jsonb!, change_note:text, created_by:uuid, created_at:tstz!
- `catalog.questions`: id:uuid!, program_code:text!, section_id:uuid!, question_type_code:text!, passage_id:uuid, topic_id:uuid, current_version_id:uuid, status:content_status!, source:content_source!, difficulty_target:difficulty, irt_a:numeric, irt_b:numeric, irt_c:numeric, irt_fitted_at:tstz, exposure_count:integer!, correct_count:integer!, avg_time_ms:integer, created_by:uuid, created_at:tstz!, updated_at:tstz!, retired_at:tstz
- `catalog.sections`: id:uuid!, program_code:text!, skill_id:uuid!, code:text!, name:jsonb!, level:text, sort_order:smallint!, duration_sec:integer, question_count:smallint, rules:jsonb!
- `catalog.skills`: id:uuid!, program_code:text!, code:text!, name:jsonb!, sort_order:smallint!
- `catalog.subskills`: id:uuid!, program_code:text!, skill_id:uuid!, code:text!, name:jsonb!, description:jsonb
- `catalog.test_set_items`: test_set_id:uuid!, question_id:uuid!, section_id:uuid!, sort_order:smallint!, group_key:text, points:numeric!
- `catalog.test_set_sections`: test_set_id:uuid!, section_id:uuid!, sort_order:smallint!, duration_sec:integer
- `catalog.test_sets`: id:uuid!, program_code:text!, code:text!, title:jsonb!, kind:test_set_kind!, level:text, is_free:boolean!, duration_sec:integer, year_tag:smallint, status:content_status!, published_at:tstz, created_at:tstz!
- `catalog.topics`: id:uuid!, program_code:text, code:text!, name:jsonb!
- `catalog.video_sentences`: id:uuid!, video_id:uuid!, sort_order:integer!, start_ms:integer!, end_ms:integer!, text:text!, ipa:text, reading:text, translations:jsonb!
- `catalog.videos`: id:uuid!, program_code:text!, youtube_id:text!, title:text!, channel:text, duration_sec:integer, language:text!, category:video_category!, level:text, status:content_status!, submitted_by:uuid, segment_job:jsonb, created_at:tstz!
- `catalog.vocab_items`: id:uuid!, program_code:text!, kind:vocab_kind!, headword:text!, reading:text, sino_vietnamese:text, pos:text, ipa_uk:text, ipa_us:text, audio_uk_id:uuid, audio_us_id:uuid, meanings:jsonb!, examples:jsonb!, collocations:jsonb!, radicals:_text, stroke_count:smallint, level:text, frequency_rank:integer, source:content_source!, status:content_status!, created_at:tstz!
- `catalog.vocab_list_items`: list_id:uuid!, vocab_item_id:uuid!, sort_order:integer!
- `catalog.vocab_lists`: id:uuid!, program_code:text!, kind:text!, title:jsonb!, test_set_id:uuid, topic_id:uuid, owner_user_id:uuid, is_free:boolean!, sort_order:smallint!, created_at:tstz!

## learn

- `learn.assignment_submissions`: assignment_id:uuid!, user_id:uuid!, result_ref:jsonb, completed_at:tstz
- `learn.assignments`: id:uuid!, org_id:uuid!, class_id:uuid!, created_by:uuid!, title:text!, task_type:plan_task_type!, ref_type:text, ref_id:uuid, due_at:tstz, created_at:tstz!
- `learn.attempt_answers`: id:uuid!, attempt_id:uuid!, question_id:uuid!, question_version_id:uuid!, answer:jsonb, is_correct:boolean, score:numeric, time_spent_ms:integer, flagged:boolean!, created_at:tstz!
- `learn.attempts`: id:uuid!, user_id:uuid!, program_code:text!, test_set_id:uuid, section_id:uuid, mode:attempt_mode!, status:attempt_status!, started_at:tstz!, submitted_at:tstz, time_spent_sec:integer, raw_score:numeric, scaled_score:numeric, score_breakdown:jsonb, draft_state:jsonb, device:jsonb, tab_leave_count:smallint!, plan_task_id:uuid
- `learn.badges`: code:text!, name:jsonb!, rule:jsonb!
- `learn.chat_messages`: id:uuid!, thread_id:uuid!, role:text!, content:jsonb!, ai_task_id:uuid, created_at:tstz!
- `learn.chat_threads`: id:uuid!, user_id:uuid!, program_code:text, context:jsonb, title:text, created_at:tstz!, updated_at:tstz!
- `learn.enrollments`: id:uuid!, user_id:uuid!, program_code:text!, target_score:numeric, target_level:text, exam_date:date, daily_minutes:smallint!, current_level:jsonb, is_active:boolean!, started_at:tstz!, updated_at:tstz!
- `learn.error_log_entries`: id:uuid!, user_id:uuid!, program_code:text!, attempt_answer_id:uuid, submission_id:uuid, question_id:uuid, subskill_id:uuid, error_kind:error_kind!, reason_auto:jsonb, reason_override:error_kind, resolved_at:tstz, created_at:tstz!
- `learn.grading_results`: id:uuid!, submission_id:uuid!, rubric_code:text!, overall_score:numeric, criterion_scores:jsonb!, feedback:jsonb!, errors:jsonb!, model_answer:text, model_answer_meta:jsonb, confidence:text!, prompt_version_id:uuid, ai_task_id:uuid, graded_at:tstz!
- `learn.lesson_progress`: user_id:uuid!, lesson_id:uuid!, status:text!, current_step:smallint!, score:numeric, chat_thread_id:uuid, started_at:tstz!, completed_at:tstz
- `learn.notes`: id:uuid!, user_id:uuid!, test_set_id:uuid, question_id:uuid, body:text!, updated_at:tstz!
- `learn.phrasing_fixes`: id:uuid!, grading_result_id:uuid!, error_index:smallint!, user_rewrite:text, verdict:text, ai_note:text, carried_over:boolean!, created_at:tstz!
- `learn.plan_tasks`: id:uuid!, plan_week_id:uuid!, due_date:date!, task_type:plan_task_type!, ref_type:text, ref_id:uuid, title:jsonb, est_minutes:smallint, status:plan_task_status!, evidence:jsonb, completed_at:tstz, result_ref:jsonb
- `learn.plan_weeks`: id:uuid!, plan_id:uuid!, week_no:smallint!, start_date:date!, focus_skill_id:uuid, focus_section_id:uuid, load_minutes:smallint, checkin_done_at:tstz, adjustment:jsonb
- `learn.pronunciation_scores`: id:uuid!, submission_id:uuid!, accuracy:numeric, fluency:numeric, prosody:numeric, completeness:numeric, overall:numeric, words:jsonb!, tones:jsonb, pitch_contour:jsonb, provider:text!, created_at:tstz!
- `learn.recordings`: id:uuid!, user_id:uuid!, storage_key:text!, mime_type:text!, duration_ms:integer, size_bytes:integer, transcript:jsonb, stt_confidence:numeric, expires_at:tstz, created_at:tstz!
- `learn.score_forecasts`: id:uuid!, enrollment_id:uuid!, predicted_score:numeric!, ci_low:numeric, ci_high:numeric, ready_date:date, model_version:text!, computed_at:tstz!
- `learn.shadowing_progress`: user_id:uuid!, video_id:uuid!, sentences_done:integer!, best_scores:jsonb!, updated_at:tstz!
- `learn.skill_mastery`: user_id:uuid!, program_code:text!, subskill_id:uuid!, mastery:numeric!, confidence:numeric, n_obs:integer!, updated_at:tstz!
- `learn.srs_cards`: id:uuid!, user_id:uuid!, program_code:text!, card_type:srs_card_type!, ref_id:uuid!, source_type:text, source_id:uuid, state:srs_state!, stability:real, difficulty:real, due_at:tstz!, last_review_at:tstz, reps:integer!, lapses:integer!, suspended:boolean!, created_at:tstz!
- `learn.srs_reviews`: id:uuid!, card_id:uuid!, rating:smallint!, review_mode:text, elapsed_days:real, scheduled_days:real, reviewed_at:tstz!
- `learn.streaks`: user_id:uuid!, current_streak:integer!, longest_streak:integer!, last_active_date:date, freeze_available_at:date, freezes_used:integer!, updated_at:tstz!
- `learn.study_plans`: id:uuid!, enrollment_id:uuid!, version_no:integer!, strategy:jsonb!, generated_by:text!, is_current:boolean!, generated_at:tstz!
- `learn.submissions`: id:uuid!, user_id:uuid!, program_code:text!, kind:submission_kind!, prompt_ref_type:text!, prompt_ref_id:uuid, attempt_id:uuid, parent_submission_id:uuid, text_body:text, recording_id:uuid, attachment_id:uuid, word_count:integer, duration_ms:integer, status:submission_status!, job_id:text, error:text, created_at:tstz!, graded_at:tstz
- `learn.user_badges`: user_id:uuid!, badge_code:text!, earned_at:tstz!
- `learn.v_user_program_summary`: user_id:uuid, program_code:text, target_score:numeric, exam_date:date, last_scaled_score:numeric, cards_due:bigint, current_streak:integer
- `learn.xp_events`: id:uuid!, user_id:uuid!, kind:text!, amount:integer!, ref_type:text, ref_id:uuid, created_at:tstz!

## ai

- `ai.ai_tasks`: id:uuid!, user_id:uuid, task_code:text!, prompt_version_id:uuid, model_used:text, provider:text, status:task_status!, input_ref:jsonb, input_hash:text, output:jsonb, tokens_in:integer, tokens_out:integer, audio_seconds:numeric, cost_usd:numeric, credits_charged:integer!, latency_ms:integer, trace_id:text, error:text, created_at:tstz!, finished_at:tstz
- `ai.embeddings`: id:uuid!, entity_type:text!, entity_id:uuid!, model:text!, embedding:vector!, created_at:tstz!
- `ai.eval_items`: id:uuid!, eval_set_id:uuid!, input:jsonb!, gold:jsonb!, notes:text
- `ai.eval_run_items`: run_id:uuid!, eval_item_id:uuid!, output:jsonb!, diff:numeric
- `ai.eval_runs`: id:uuid!, eval_set_id:uuid!, prompt_version_id:uuid!, model:text!, metrics:jsonb!, passed:boolean!, run_at:tstz!, triggered_by:text
- `ai.eval_sets`: id:uuid!, task_code:text!, program_code:text, name:text!, description:text, thresholds:jsonb!, created_at:tstz!
- `ai.explanation_cache`: id:uuid!, question_version_id:uuid!, chosen_option:text!, locale:text!, content:jsonb!, prompt_version_id:uuid, hit_count:integer!, quality_score:numeric, created_at:tstz!
- `ai.feedback`: id:uuid!, user_id:uuid!, ai_task_id:uuid!, rating:text!, comment:text, created_at:tstz!
- `ai.model_routes`: id:uuid!, task_code:text!, primary_model:text!, fallback_models:_text!, params:jsonb!, timeout_ms:integer!, max_cost_usd:numeric, credits_cost:integer!, is_active:boolean!, updated_at:tstz!
- `ai.prompt_templates`: id:uuid!, code:text!, program_code:text, description:text
- `ai.prompt_versions`: id:uuid!, template_id:uuid!, version_no:integer!, system_prompt:text!, user_template:text!, few_shots:jsonb!, rubric:jsonb, output_schema:jsonb!, model_policy:jsonb!, status:prompt_status!, canary_percent:smallint!, eval_run_id:uuid, created_by:uuid, created_at:tstz!
- `ai.translation_cache`: id:uuid!, source_hash:text!, source_lang:text!, target_lang:text!, text:text!, created_at:tstz!
- `ai.tts_cache`: id:uuid!, text_hash:text!, voice:text!, storage_key:text!, duration_ms:integer, created_at:tstz!

## billing

- `billing.credit_balances`: owner_type:text!, owner_id:uuid!, balance:integer!, updated_at:tstz!
- `billing.credit_ledger`: id:bigint!, user_id:uuid, org_id:uuid, delta:integer!, balance_after:integer!, reason:credit_reason!, ref_type:text, ref_id:uuid, ai_task_id:uuid, expires_at:tstz, note:text, created_at:tstz!
- `billing.entitlements`: id:uuid!, user_id:uuid!, program_code:text, feature_code:text!, source:text!, source_id:uuid, valid_from:tstz!, valid_to:tstz
- `billing.feature_flags`: key:text!, enabled:boolean!, rules:jsonb!, updated_at:tstz!
- `billing.invoices`: id:uuid!, order_id:uuid!, provider:text!, series:text, invoice_no:text, lookup_code:text, status:text!, pdf_url:text, raw:jsonb, issued_at:tstz, created_at:tstz!
- `billing.orders`: id:uuid!, user_id:uuid!, org_id:uuid, plan_id:uuid!, price_id:uuid!, promotion_id:uuid, quantity:integer!, currency:character!, subtotal:numeric!, discount:numeric!, total:numeric!, status:order_status!, idempotency_key:text!, buyer_info:jsonb, created_at:tstz!, paid_at:tstz, expires_at:tstz
- `billing.payments`: id:uuid!, order_id:uuid!, provider:payment_provider!, provider_txn_id:text, amount:numeric!, currency:character!, status:text!, raw_callback:jsonb, signature_valid:boolean, created_at:tstz!, confirmed_at:tstz
- `billing.plans`: id:uuid!, code:text!, kind:plan_kind!, program_codes:_text!, name:jsonb!, description:jsonb, credits_included:integer!, credits_period:text, duration_days:integer, features:jsonb!, is_active:boolean!, sort_order:smallint!
- `billing.prices`: id:uuid!, plan_id:uuid!, currency:character!, amount:numeric!, compare_at:numeric, region:text!, valid_from:tstz!, valid_to:tstz
- `billing.promotions`: id:uuid!, code:text!, kind:text!, value:numeric!, plan_ids:_uuid, valid_from:tstz!, valid_to:tstz!, max_uses:integer, used_count:integer!, per_user_limit:smallint!, is_active:boolean!
- `billing.quotas`: id:uuid!, plan_kind:plan_kind!, feature_code:text!, period:quota_period!, limit_value:integer!
- `billing.reconciliation_runs`: id:uuid!, provider:payment_provider!, for_date:date!, expected_total:numeric, actual_total:numeric, mismatches:jsonb!, status:text!, run_at:tstz!
- `billing.subscriptions`: id:uuid!, user_id:uuid, org_id:uuid, plan_id:uuid!, program_code:text, status:subscription_status!, current_period_start:tstz!, current_period_end:tstz, cancel_at_period_end:boolean!, provider_token_ref:text, source_order_id:uuid, seats:integer, created_at:tstz!, updated_at:tstz!
- `billing.usage_counters`: user_id:uuid!, feature_code:text!, period_key:text!, used:integer!, updated_at:tstz!
- `billing.v_active_entitlements`: user_id:uuid, program_code:text, feature_code:text, valid_from:tstz, valid_to:tstz

## ops

- `ops.audit_logs`: id:bigint!, actor_user_id:uuid, actor_role:text, action:text!, entity_type:text, entity_id:uuid, before:jsonb, after:jsonb, ip:inet, user_agent:text, created_at:tstz!
- `ops.content_reports`: id:uuid!, user_id:uuid, entity_type:text!, entity_id:uuid!, reason:text!, status:text!, resolved_by:uuid, created_at:tstz!, resolved_at:tstz
- `ops.feedback`: id:uuid!, user_id:uuid, kind:text!, body:text!, page:text, context:jsonb, status:text!, created_at:tstz!
- `ops.jobs_deadletter`: id:uuid!, queue:text!, job_id:text!, payload:jsonb, error:text, attempts:smallint, failed_at:tstz!
- `ops.notification_preferences`: user_id:uuid!, channels:jsonb!, quiet_hours:jsonb!, reminder_times:_text!, updated_at:tstz!
- `ops.notifications`: id:uuid!, user_id:uuid!, channel:notification_channel!, template_code:text!, payload:jsonb!, status:text!, scheduled_at:tstz!, sent_at:tstz, read_at:tstz, error:text
- `ops.outbox`: id:bigint!, aggregate_type:text!, aggregate_id:uuid, event_type:text!, payload:jsonb!, created_at:tstz!, published_at:tstz
- `ops.support_tickets`: id:uuid!, user_id:uuid, subject:text!, body:text, channel:text, status:text!, priority:text!, assigned_to:uuid, created_at:tstz!, updated_at:tstz!

