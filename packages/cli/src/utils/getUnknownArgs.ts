/**
 * Filters out unknown arguments from the provided args array
 * @param args - The arguments to filter
 * @param validFlags - The list of valid flags
 * @returns Array of unknown arguments (excluding those that come after skip flags)
 */
export function getUnknownArgs({
  args,
  validFlags,
  singleValueFlags = [],
  variadicValueFlags = ['-s', '--skip'],
}: {
  args: string[];
  validFlags: string[];
  singleValueFlags?: string[];
  variadicValueFlags?: string[];
}): string[] {
  const unknownArgs: string[] = [];
  let variadicValueMode = false;
  let waitingForSingleValue = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (waitingForSingleValue) {
      if (!arg.startsWith('-')) {
        waitingForSingleValue = false;
        continue;
      }

      waitingForSingleValue = false;
    }

    if (variadicValueFlags.includes(arg)) {
      variadicValueMode = true;
      continue;
    }

    if (singleValueFlags.includes(arg)) {
      waitingForSingleValue = true;
      variadicValueMode = false;
      continue;
    }

    if (variadicValueMode && !validFlags.includes(arg)) {
      continue;
    }

    if (validFlags.includes(arg)) {
      variadicValueMode = false;
      continue;
    }

    unknownArgs.push(arg);
  }

  return unknownArgs;
}
