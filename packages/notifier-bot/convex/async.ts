export function getTimeoutMs(envName: string, fallbackMs: number): number {
  const rawValue = process.env[envName];
  if (!rawValue) return fallbackMs;

  const parsedValue = Number(rawValue);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallbackMs;
}

export async function withTimeout<T>(
  operation: Promise<T>,
  args: {
    label: string;
    timeoutMs: number;
  },
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${args.label} timed out after ${args.timeoutMs}ms`));
    }, args.timeoutMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
