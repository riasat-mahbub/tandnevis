import type { DeepReadonly, SceneGenerationContext } from './generation-context';

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

/**
 * Fingerprint the exact scene-only model input using sorted JSON keys and
 * UTF-16-code-unit FNV-1a 64-bit. Project revision and display-only state are
 * excluded so unrelated edits elsewhere in the story do not mark a draft stale.
 */
export function generationInputFingerprint(context: DeepReadonly<SceneGenerationContext>, defaultGuidance: string, purpose: 'prose' | 'beats' = 'prose'): string {
  const input = {
    schemaVersion: context.schemaVersion,
    scene: context.scene,
    summaryBoard: context.summaryBoard,
    beats: context.beats,
    referencedCharacters: context.referencedCharacters,
    referencedPresets: context.referencedPresets,
    unresolvedReferences: context.unresolvedReferences,
    defaultGuidance,
    ...(purpose === 'beats' ? { purpose } : {}),
  };
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const serialized = stableJson(input);
  for (let index = 0; index < serialized.length; index++) {
    hash ^= BigInt(serialized.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}
