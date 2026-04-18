import { type UpdateType } from '@patch-pulse/shared';
import { type ReleaseEvidence } from './releaseEvidence';
import { getTimeoutMs, withTimeout } from './async';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_NANO_MODEL = 'gpt-5-nano';
const DEFAULT_MINI_MODEL = 'gpt-5-mini';
const OPENAI_SUMMARY_TIMEOUT_MS = getTimeoutMs(
  'OPENAI_SUMMARY_TIMEOUT_MS',
  15_000,
);

function buildSummaryPrompt(args: {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  updateType: UpdateType;
  evidence: ReleaseEvidence;
}): string {
  const { packageName, fromVersion, toVersion, updateType, evidence } = args;

  const sections = [
    `Package: ${packageName}`,
    `Update: ${fromVersion} -> ${toVersion} (${updateType})`,
  ];

  if (evidence.releaseTag) {
    sections.push(`Release tag: ${evidence.releaseTag}`);
  }
  if (evidence.releaseName) {
    sections.push(`Release name: ${evidence.releaseName}`);
  }
  if (evidence.releaseBody) {
    sections.push(`Release notes:\n${evidence.releaseBody}`);
  }
  if (evidence.commitTitles.length > 0) {
    sections.push(
      `Commit titles:\n${evidence.commitTitles.map((title) => `- ${title}`).join('\n')}`,
    );
  }
  if (evidence.changedFiles.length > 0) {
    sections.push(
      `Changed files:\n${evidence.changedFiles.map((file) => `- ${file}`).join('\n')}`,
    );
  }

  return sections.join('\n\n');
}

async function callOpenAiSummary(
  model: string,
  prompt: string,
): Promise<string | null> {
  // Caller (summarizeReleaseEvidence) guards that the key exists before calling.
  const apiKey = process.env.OPENAI_API_KEY!;

  return withTimeout(
    (async () => {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text:
                    'You summarize software releases for Slack. Use only the provided evidence. ' +
                    'Do not speculate. Return a single plain-text sentence under 240 characters. ' +
                    'If the evidence is insufficient, return exactly INSUFFICIENT.',
                },
              ],
            },
            {
              role: 'user',
              content: [{ type: 'input_text', text: prompt }],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error ${response.status}`);
      }

      const data = (await response.json()) as {
        output_text?: string;
      };

      return data.output_text?.trim() || null;
    })(),
    {
      label: `OpenAI summary request (${model})`,
      timeoutMs: OPENAI_SUMMARY_TIMEOUT_MS,
    },
  );
}

export async function summarizeReleaseEvidence(args: {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  updateType: UpdateType;
  evidence: ReleaseEvidence;
}): Promise<{ model: string; summary: string } | null> {
  const prompt = buildSummaryPrompt(args);

  if (!process.env.OPENAI_API_KEY) return null;

  for (const model of [
    process.env.OPENAI_SUMMARY_NANO_MODEL ?? DEFAULT_NANO_MODEL,
    process.env.OPENAI_SUMMARY_MINI_MODEL ?? DEFAULT_MINI_MODEL,
  ]) {
    const summary = await callOpenAiSummary(model, prompt);
    if (!summary || summary === 'INSUFFICIENT') continue;
    return { model, summary };
  }

  return null;
}
