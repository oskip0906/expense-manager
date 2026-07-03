/**
 * Gemini wrappers for the two AI steps: classification (cheap flash-lite) and
 * suggestions (capable flash). Both request structured JSON via a responseSchema
 * and parse the model output with the shared zod schemas, so malformed model
 * output surfaces as a thrown ZodError rather than corrupting Firestore.
 */
import { GoogleGenAI, Type } from '@google/genai';
import {
  GEMINI_MODELS,
  NEW_CATEGORY_SENTINEL,
  PIPELINE,
  geminiClassificationResponseSchema,
  geminiSuggestionSchema,
  type Category,
  type GeminiClassificationResponse,
  type GeminiSuggestionResponse,
} from '@expense/shared';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

let _ai: GoogleGenAI | null = null;
/**
 * Lazily construct the client. Importing this module at deploy-discovery time
 * (before the GEMINI_API_KEY secret is attached to the process env) must not
 * throw — the key is only needed when the pipeline actually runs.
 */
function getAi(): GoogleGenAI {
  if (!_ai) _ai = new GoogleGenAI({ apiKey: requireEnv('GEMINI_API_KEY') });
  return _ai;
}

/** Minimal transaction shape the classifier needs (id + descriptive text). */
export interface ClassifyInput {
  txnId: string;
  name: string;
  merchantName: string | null;
  amount: number;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const classificationResponseSchema = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          txnId: { type: Type.STRING },
          categoryName: { type: Type.STRING },
          newCategory: {
            type: Type.OBJECT,
            nullable: true,
            properties: {
              name: { type: Type.STRING },
              description: { type: Type.STRING },
            },
            required: ['name'],
          },
          confidence: { type: Type.NUMBER },
        },
        required: ['txnId', 'categoryName'],
      },
    },
  },
  required: ['items'],
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Classify a list of transactions into existing category NAMES, or ask for a
 * NEW category via the sentinel. Runs in batches of PIPELINE.classifyBatchSize
 * and concatenates the per-batch `items`. The caller maps names -> ids and
 * handles new-category creation.
 */
export async function classifyTransactions(
  categories: Pick<Category, 'name' | 'description'>[],
  txns: ClassifyInput[],
): Promise<GeminiClassificationResponse> {
  const items: GeminiClassificationResponse['items'] = [];
  if (txns.length === 0) return { items };

  const categoryNames = categories.map((c) => c.name);
  const categoryList = categories
    .map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`)
    .join('\n');

  for (const batch of chunk(txns, PIPELINE.classifyBatchSize)) {
    const prompt = [
      'You are a personal-finance transaction classifier.',
      'Assign each transaction to the SINGLE best-fitting category from the list below.',
      'Reuse an existing category whenever it reasonably fits — prefer reuse strongly.',
      `Only if NONE of the existing categories fit, set categoryName to "${NEW_CATEGORY_SENTINEL}"`,
      'and provide a concise newCategory {name, description} (name <= 40 chars, Title Case,',
      'broad enough to reuse for similar future transactions — not merchant-specific).',
      '',
      'Existing categories:',
      categoryList,
      '',
      'Return one item per input transaction, preserving the given txnId exactly.',
      'Transactions (JSON):',
      JSON.stringify(
        batch.map((t) => ({
          txnId: t.txnId,
          name: t.name,
          merchant: t.merchantName,
          amount: t.amount,
        })),
      ),
    ].join('\n');

    const res = await getAi().models.generateContent({
      model: GEMINI_MODELS.classify,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: classificationResponseSchema,
        // Give the model the exact allowed set so reuse is easy to honor.
        systemInstruction: `Allowed existing category names: ${JSON.stringify(
          categoryNames,
        )}. The sentinel "${NEW_CATEGORY_SENTINEL}" means "create a new category".`,
      },
    });

    const text = res.text;
    if (!text) {
      throw new Error('Gemini classify returned an empty response');
    }
    const parsed = geminiClassificationResponseSchema.parse(JSON.parse(text));
    items.push(...parsed.items);
  }

  return { items };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const suggestionResponseSchema = {
  type: Type.OBJECT,
  properties: {
    tips: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          body: { type: Type.STRING },
          categoryName: { type: Type.STRING, nullable: true },
          severity: { type: Type.STRING, enum: ['info', 'warn', 'alert'] },
        },
        required: ['title', 'body', 'severity'],
      },
    },
  },
  required: ['tips'],
};

/**
 * Given a compact summary of the user's spending situation (already gated so
 * we only call this when something noteworthy happened), produce up to
 * PIPELINE.maxTipsPerDay short, actionable tips.
 */
export async function suggest(summary: string): Promise<GeminiSuggestionResponse> {
  const prompt = [
    'You are a concise, supportive personal-finance coach.',
    `Produce at most ${PIPELINE.maxTipsPerDay} short, specific, actionable tips based ONLY on`,
    'the situation summary below. Do not invent numbers not present in the summary.',
    'Each tip: a punchy title (<= 80 chars) and a body (<= 400 chars).',
    'Set severity to "alert" for over-budget/projected-over situations, "warn" for approaching',
    'limits or sharp spikes, "info" otherwise. When a tip is about one category, set categoryName',
    'to that exact category name; otherwise leave it null.',
    '',
    'Situation summary:',
    summary,
  ].join('\n');

  const res = await getAi().models.generateContent({
    model: GEMINI_MODELS.suggest,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: suggestionResponseSchema,
    },
  });

  const text = res.text;
  if (!text) {
    throw new Error('Gemini suggest returned an empty response');
  }
  return geminiSuggestionSchema.parse(JSON.parse(text));
}
