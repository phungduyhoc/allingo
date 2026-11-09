import * as migration_20261102_024739_initial from './20261102_024739_initial';
import * as migration_20261102_054056_s10_marketing from './20261102_054056_s10_marketing';
import * as migration_20261108_022258_s12_content_reports from './20261108_022258_s12_content_reports';
import * as migration_20261108_201805_b5_passage_parts_blueprint from './20261108_201805_b5_passage_parts_blueprint';
import * as migration_20261108_223554_c2_ielts_question_types from './20261108_223554_c2_ielts_question_types';
import * as migration_20261109_020756_c3_ielts_module from './20261109_020756_c3_ielts_module';

export const migrations = [
  {
    up: migration_20261102_024739_initial.up,
    down: migration_20261102_024739_initial.down,
    name: '20261102_024739_initial',
  },
  {
    up: migration_20261102_054056_s10_marketing.up,
    down: migration_20261102_054056_s10_marketing.down,
    name: '20261102_054056_s10_marketing',
  },
  {
    up: migration_20261108_022258_s12_content_reports.up,
    down: migration_20261108_022258_s12_content_reports.down,
    name: '20261108_022258_s12_content_reports',
  },
  {
    up: migration_20261108_201805_b5_passage_parts_blueprint.up,
    down: migration_20261108_201805_b5_passage_parts_blueprint.down,
    name: '20261108_201805_b5_passage_parts_blueprint',
  },
  {
    up: migration_20261108_223554_c2_ielts_question_types.up,
    down: migration_20261108_223554_c2_ielts_question_types.down,
    name: '20261108_223554_c2_ielts_question_types',
  },
  {
    up: migration_20261109_020756_c3_ielts_module.up,
    down: migration_20261109_020756_c3_ielts_module.down,
    name: '20261109_020756_c3_ielts_module'
  },
];
