import * as migration_20261102_024739_initial from './20261102_024739_initial';
import * as migration_20261102_054056_s10_marketing from './20261102_054056_s10_marketing';

export const migrations = [
  {
    up: migration_20261102_024739_initial.up,
    down: migration_20261102_024739_initial.down,
    name: '20261102_024739_initial',
  },
  {
    up: migration_20261102_054056_s10_marketing.up,
    down: migration_20261102_054056_s10_marketing.down,
    name: '20261102_054056_s10_marketing'
  },
];
