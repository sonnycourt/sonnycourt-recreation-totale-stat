function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default async (req) => {
  const secret = String(process.env.EMAIL_DIVISION_AUTONOMY_SECRET || '').trim();
  if (!secret) {
    console.error('[email-division-daily-pulse] EMAIL_DIVISION_AUTONOMY_SECRET is missing');
    return json(503, { error: 'autonomy_schedule_not_configured' });
  }
  try {
    const workerUrl = new URL('/.netlify/functions/admin-email-marketing-autonomy-worker-background', req.url);
    const response = await fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-email-division-autonomy-secret': secret,
      },
      body: JSON.stringify({ operation: 'execute_daily_pulse', trigger: 'scheduled', force: false }),
    });
    if (!response.ok) throw new Error(`autonomy_worker_${response.status}`);
    return json(202, { accepted: true, mailerliteWritePerformed: false, mailerliteSendPerformed: false });
  } catch (error) {
    console.error('[email-division-daily-pulse] dispatch failed', String(error?.message || error).slice(0, 120));
    return json(502, { error: 'autonomy_schedule_dispatch_failed' });
  }
};
