import { withLambda } from '@netlify/aws-lambda-compat';
import legacy from './lib/legacy/generate-page-content.cjs';

export default withLambda(legacy.handler);
