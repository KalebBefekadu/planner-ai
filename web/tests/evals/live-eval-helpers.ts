export function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function providerErrorLabel(error: unknown) {
  const value = error as { status?: unknown; name?: unknown; code?: unknown };
  return (
    [value?.status, value?.name, value?.code]
      .filter(
        (part): part is string | number => typeof part === 'string' || typeof part === 'number'
      )
      .join(':') || 'unknown'
  );
}

export function debugProviderError(event: string, error: unknown) {
  if (process.env.AI_EVAL_DEBUG !== '1') return;
  const value = error as { status?: unknown; name?: unknown; code?: unknown; message?: unknown };
  console.error(
    JSON.stringify({
      event,
      status: value?.status ?? null,
      name: value?.name ?? null,
      code: value?.code ?? null,
      message: typeof value?.message === 'string' ? value.message.slice(0, 800) : null,
    })
  );
}
