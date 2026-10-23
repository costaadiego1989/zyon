import { loadEnv } from 'vite';
import policy from '../../../scripts/lib/dashboard-auth-build-policy.cjs';

try {
  policy.validatePublicAuthConfig(loadEnv('production', process.cwd(), 'VITE_'));
  console.log('Dashboard public auth configuration: valid (values omitted).');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
