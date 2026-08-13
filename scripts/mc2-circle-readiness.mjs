import {
  findCircleTag,
  MC2_CIRCLE_TAG_NAME,
  mc2CircleReadiness,
} from '../netlify/functions/lib/mc2-circle-onboarding.mjs';

const liveReadOnly = process.argv.includes('--live-read-only');
const readiness = mc2CircleReadiness(process.env);
const report = {
  enabled: readiness.enabled,
  token_configured: readiness.token,
  host_configured: readiness.host,
  exact_tag_name_configured: readiness.tag_exact,
  ready: readiness.ready,
  live_read_only_requested: liveReadOnly,
};

if (liveReadOnly) {
  if (!readiness.token || !readiness.host || !readiness.tag_exact) {
    report.live_read_only = 'blocked_missing_configuration';
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    try {
      // The only provider request made by this check is GET /member_tags.
      const tag = await findCircleTag({ env: process.env });
      report.live_read_only = 'ok';
      report.tag = { id: String(tag.id), name: MC2_CIRCLE_TAG_NAME };
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      report.live_read_only = 'failed';
      report.error = String(error?.code || error?.message || 'circle_error').slice(0, 160);
      console.log(JSON.stringify(report, null, 2));
      process.exitCode = 1;
    }
  }
} else {
  report.next = 'Ajouter --live-read-only après configuration pour vérifier le tag sans mutation.';
  console.log(JSON.stringify(report, null, 2));
}
