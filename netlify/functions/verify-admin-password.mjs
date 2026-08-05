import { withLambda } from '@netlify/aws-lambda-compat';
import legacy from './lib/legacy/verify-admin-password.cjs';

export default withLambda(legacy.handler);
