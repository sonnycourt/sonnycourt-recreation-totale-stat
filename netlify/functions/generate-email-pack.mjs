import { withLambda } from '@netlify/aws-lambda-compat';
import legacy from './lib/legacy/generate-email-pack.cjs';

export default withLambda(legacy.handler);
