import { apiConfig } from '@allingo/config/eslint/api';
export default [...apiConfig, { ignores: ['dist/**', 'openapi.generated.yaml', 'eval/**'] }];
