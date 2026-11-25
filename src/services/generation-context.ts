import type { JSONContent } from '@tiptap/core';
import type { Character, Preset, PresetKind, ProjectSnapshot, Scene } from './project';
import { summaryBoard } from './summary-board';
import { readableRelationships, relationshipChangeText, relationshipContext, sceneRelationshipCharacters } from './relationships';
import type { RelationshipContext } from './relationships';

/** A JSON value whose nested objects and arrays cannot be edited by a caller. */
export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export interface CharacterOccurrence {
  /** Indexes into successive `content` arrays in the beat's original document. */
  path: number[];
  characterId: string;
  occurrenceId: string;
  label: string;
  emotion: string;
  delivery: string;
  profileResolved: boolean;
  profileArchived: boolean;
}

export interface GenerationBeat {
  id: string;
  order: number;
  /** Original rich-text structure, including inline references and their position. */
  document: JSONContent;
  /** Readable rendering of this beat; plain text stays ordinary prose. */
  readableText: string;
  references: CharacterOccurrence[];
}

export interface GenerationCharacter {
  id: string;
  name: string;
  background: string;
  personality: string;
  voice: string;
  archived: boolean;
  defaultToneId: string;
  defaultEmotionId: string;
}
export interface GenerationPreset extends Omit<Preset, 'color'> { kind: PresetKind }

/**
 * Immutable, scene-scoped generation input. It deliberately has no project-wide
 * story dump, chapter list, Trash, import source, or unreferenced character data.
 */
export interface SceneGenerationContext {
  schemaVersion: 2;
  relationships?: RelationshipContext;
  projectId: string;
  projectRevision: number;
  scene: {
    id: string;
    title: string;
    summary: string;
    summaryDocument: JSONContent;
    tone: string;
    toneId: string;
    narration: Scene['narration'];
  };
  summaryBoard: GenerationBeat;
  beats: GenerationBeat[];
  /** First-reference order, with each referenced profile listed once. */
  referencedCharacters: GenerationCharacter[];
  referencedPresets: GenerationPreset[];
  /** References whose profile has since been removed; their original nodes remain intact. */
  unresolvedReferences: Array<{
    beatId: string;
    path: number[];
    characterId: string;
    label: string;
  }>;
  /** Preview text matching the scene direction and selected beat content. */
  readableContext: string;
}

function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneJson) as T;
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) clone[key] = cloneJson(entry);
    return clone as T;
  }
  return value;
}

function freezeDeep<T>(value: T): DeepReadonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) freezeDeep(entry);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

const stringAttr = (node: JSONContent, key: string): string => {
  const value = node.attrs?.[key];
  return typeof value === 'string' ? value : '';
};

function contentOf(node: JSONContent): JSONContent[] {
  return Array.isArray(node.content) ? node.content : [];
}

function collectReferences(
  node: JSONContent,
  path: number[],
  characterById: ReadonlyMap<string, Character>,
  result: CharacterOccurrence[],
): void {
  if (node.type === 'characterReference') {
    const characterId = stringAttr(node, 'characterId');
    const profile = characterById.get(characterId);
    result.push({
      path: [...path],
      characterId,
      occurrenceId: stringAttr(node, 'occurrenceId'),
      label: profile?.name || stringAttr(node, 'label') || 'Character',
      emotion: stringAttr(node, 'emotion'),
      delivery: stringAttr(node, 'delivery'),
      profileResolved: !!profile,
      profileArchived: profile?.archived ?? false,
    });
  }
  contentOf(node).forEach((child, index) => collectReferences(child, [...path, index], characterById, result));
}

function renderNode(node: JSONContent, characterById: ReadonlyMap<string, Character>): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'horizontalRule') return '\n---\n';
  if (node.type === 'characterReference') {
    const characterId = stringAttr(node, 'characterId');
    const profile = characterById.get(characterId);
    const name = profile?.name || stringAttr(node, 'label') || 'Character';
    const direction = [
      stringAttr(node, 'emotion') && `emotion: ${stringAttr(node, 'emotion')}`,
      stringAttr(node, 'delivery') && `delivery: ${stringAttr(node, 'delivery')}`,
    ].filter(Boolean);
    return `[${name}${direction.length ? ` — ${direction.join('; ')}` : ''}]`;
  }

  const children = contentOf(node).map(child => renderNode(child, characterById));
  switch (node.type) {
    case 'paragraph':
    case 'heading':
    case 'blockquote':
      return `${children.join('')}${children.length ? '\n' : ''}`;
    case 'listItem':
      return `${children.join('').trimEnd()}\n`;
    case 'bulletList':
      return children.map(item => item.trimEnd()).filter(Boolean).map(item => `• ${item}`).join('\n') + '\n';
    case 'orderedList':
      return children.map((item, index) => `${index + 1}. ${item.trimEnd()}`).join('\n') + '\n';
    default:
      // Unknown editor nodes still contribute their descendant text instead of
      // causing neighboring authored text to disappear from the preview.
      return children.join('');
  }
}

function cleanBlock(value: string): string {
  return value.replace(/\n+$/g, '').trim();
}

function formatCharacter(character: GenerationCharacter, project: ProjectSnapshot): string {
  const tone = project.tones.find(p => p.id === character.defaultToneId);
  const emotion = project.emotions.find(p => p.id === character.defaultEmotionId);
  const facts = [
    character.background.trim() && `Background: ${character.background.trim()}`,
    character.personality.trim() && `Personality: ${character.personality.trim()}`,
    character.voice.trim() && `Baseline voice: ${character.voice.trim()}`,
    tone && `Default tone: ${tone.name}`,
    emotion && `Default emotion: ${emotion.name}`,
    character.archived && 'This profile is archived; it remains attached to an existing beat reference.',
  ].filter(Boolean);
  return `- ${character.name}${facts.length ? `\n  ${facts.join('\n  ')}` : ''}`;
}

/**
 * Build a stable snapshot for one scene. Character profiles are resolved by ID
 * at call time, so renaming a profile does not break old references. The returned
 * value is a deep-frozen copy: edits made after generation starts cannot mutate it.
 */
export function buildSceneGenerationContext(
  project: ProjectSnapshot,
  sceneId: string,
): DeepReadonly<SceneGenerationContext> {
  const scene = project.scenes.find(candidate => candidate.id === sceneId);
  if (!scene) throw new Error('The selected scene is no longer in this project.');

  const characterById = new Map(project.characters.map(character => [character.id, character]));
  const referencedIds = new Set<string>();
  const referencedPresets: GenerationPreset[] = [];
  const addPreset = (kind: PresetKind, id: string) => {
    if (!id) return undefined;
    const preset = (kind === 'tone' ? project.tones : project.emotions).find(p => p.id === id);
    if (!preset) throw new Error('A reusable block definition is missing. Repair its reference before generating.');
    if (!referencedPresets.some(p => p.kind === kind && p.id === id)) referencedPresets.push({
      kind,
      id: preset.id,
      name: preset.name,
      meaning: preset.meaning,
      guidance: preset.guidance,
      example: preset.example,
      archived: preset.archived,
      revision: preset.revision,
    });
    return preset;
  };
  const summary = summaryBoard(scene, project.tones);
  // The scene-level tone association predates inline tone tokens. Keep it as an
  // explicit legacy default; inline tokens stay in their authored positions and
  // do not replace or inherit this association.
  const sceneTone = project.tones.find(p => p.id === scene.toneId)?.name ?? scene.tone;
  const unresolvedReferences: SceneGenerationContext['unresolvedReferences'] = [];
  const resolveBoard = (beat: { id: string; document: JSONContent }, index: number, isSummary = false): GenerationBeat => {
    const document = cloneJson(beat.document);
    const references: CharacterOccurrence[] = [];
    collectReferences(document, [], characterById, references);
    const owners = new Map(references.map(r => [r.occurrenceId, r.label]));
    const displayNode = (node: JSONContent): JSONContent => {
      if (node.type === 'relationshipChange') {
        const change = project.relationshipChanges?.find(r => r.id === stringAttr(node, 'changeId') && r.sceneId === sceneId);
        if (!isSummary || !change) throw new Error('A relationship change block must reference a change in this scene summary.');
        return { type: 'text', text: relationshipChangeText(project, change) };
      }
      if (node.type === 'toneReference') {
        const preset = addPreset('tone', stringAttr(node, 'toneId'));
        if (!preset) throw new Error('A tone reference is missing its definition.');
        return { type: 'text', text: `[Tone: ${preset.name}]` };
      }
      if (node.type === 'emotionReference') {
        const preset = addPreset('emotion', stringAttr(node, 'emotionId'));
        if (!preset) throw new Error('An emotion reference is missing its definition.');
        const target = stringAttr(node, 'targetOccurrenceId');
        const owner = target && owners.get(target);
        const targetLabel = owner ? ` → ${owner}` : target ? ' → character reference unavailable' : '';
        return { type: 'text', text: `[Emotion: ${preset.name}${targetLabel}]` };
      }
      return { ...node, ...(node.content ? { content: node.content.map(displayNode) } : {}) };
    };
    const displayDocument = displayNode(document);
    for (const reference of references) {
      if (characterById.has(reference.characterId)) referencedIds.add(reference.characterId);
      else unresolvedReferences.push({
        beatId: beat.id,
        path: [...reference.path],
        characterId: reference.characterId,
        label: reference.label,
      });
    }
    return {
      id: beat.id,
      order: isSummary ? 0 : index + 1,
      document,
      readableText: cleanBlock(renderNode(displayDocument, characterById)),
      references,
    };
  };
  const resolvedSummary = resolveBoard(summary, 0, true);
  addPreset('tone', scene.toneId);
  const beats = scene.beats.map((beat, index) => resolveBoard(beat, index));
  for (const id of sceneRelationshipCharacters(project, sceneId, [...referencedIds])) {
    if (characterById.has(id)) referencedIds.add(id);
  }
  const relationships = relationshipContext(project, sceneId, [...referencedIds]);

  // Preserve first occurrence order, not global-library order.
  const referencedCharacters = [...referencedIds].map(id => {
    const character = characterById.get(id)!;
    return {
      id: character.id,
      name: character.name,
      background: character.background,
      personality: character.personality,
      voice: character.voice,
      archived: character.archived,
      defaultToneId: character.defaultToneId,
      defaultEmotionId: character.defaultEmotionId,
    };
  });

  for (const character of referencedCharacters) {
    addPreset('tone', character.defaultToneId);
    addPreset('emotion', character.defaultEmotionId);
  }

  const sceneCopy = {
    id: scene.id,
    title: scene.title,
    summary: scene.summary,
    summaryDocument: cloneJson(summary.document),
    tone: sceneTone,
    toneId: scene.toneId,
    narration: cloneJson(scene.narration),
  };
  const contextBlocks = [
    relationships && readableRelationships(project, relationships),
    `Scene: ${scene.title}`,
    resolvedSummary.readableText && `Scene summary: ${resolvedSummary.readableText}`,
    sceneTone.trim() && `Scene default tone: ${sceneTone.trim()}`,
    scene.narration.pointOfView.trim() && `Point of view: ${scene.narration.pointOfView.trim()}`,
    scene.narration.tense.trim() && `Tense: ${scene.narration.tense.trim()}`,
    scene.narration.instructions.trim() && `Narration guidance: ${scene.narration.instructions.trim()}`,
    referencedCharacters.length
      ? `Referenced character profiles:\n${referencedCharacters.map(c => formatCharacter(c, project)).join('\n')}`
      : 'Referenced character profiles: none.',
    referencedPresets.length ? `Referenced reusable blocks:\n${referencedPresets.map(p => {
      const facts = ([['Meaning', p.meaning], ['Guidance', p.guidance], ['Example', p.example]] as const).filter(([, v]) => v.trim()).map(([label, value]) => `${label}: ${value.trim()}`);
      return `- ${p.kind === 'tone' ? 'Tone' : 'Emotion'}: ${p.name}${facts.length ? `\n  ${facts.join('\n  ')}` : ''}`;
    }).join('\n')}` : '',
    beats.length
      ? `Ordered beats:\n${beats.map(beat => `Beat ${beat.order}:\n${beat.readableText || '(empty)'}`).join('\n\n')}`
      : 'Ordered beats: none.',
    unresolvedReferences.length
      ? `Unresolved character references:\n${unresolvedReferences.map(ref => `- ${ref.label} (profile unavailable; preserve this as an existing reference)`).join('\n')}`
      : '',
  ].filter((block): block is string => typeof block === 'string' && block.length > 0);

  return freezeDeep({
    schemaVersion: 2,
    ...(relationships ? { relationships: cloneJson(relationships) } : {}),
    projectId: project.projectId,
    projectRevision: project.revision,
    scene: sceneCopy,
    summaryBoard: resolvedSummary,
    beats,
    referencedCharacters,
    referencedPresets,
    unresolvedReferences,
    readableContext: contextBlocks.join('\n\n'),
  });
}
