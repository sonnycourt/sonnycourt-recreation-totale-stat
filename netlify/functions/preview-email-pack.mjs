import { withLambda } from '@netlify/aws-lambda-compat';
import legacy from './lib/legacy/preview-email-pack.cjs';

export default withLambda(legacy.handler);
