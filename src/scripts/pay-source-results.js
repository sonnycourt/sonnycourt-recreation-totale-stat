export async function collectPaySources(sources = {}) {
  const entries = Object.entries(sources);
  const settled = await Promise.allSettled(entries.map(([, request]) => Promise.resolve().then(() => request)));
  const values = {};
  const available = [];
  const unavailable = [];

  settled.forEach((result, index) => {
    const name = entries[index][0];
    if (result.status === 'fulfilled') {
      values[name] = result.value;
      available.push(name);
    } else {
      values[name] = null;
      unavailable.push(name);
    }
  });

  return { values, available, unavailable };
}

export function requirePaySource(result, code = 'pay_sources_unavailable') {
  if (result?.available?.length) return result;
  throw new Error(code);
}
