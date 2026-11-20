import type { JSONContent } from '@tiptap/core';
import type { Character, ProjectSnapshot, Scene } from './project';

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
}

/**
 * Immutable, scene-scoped generation input. It deliberately has no project-wide
 * story dump, chapter list, Trash, import source, or unreferenced character data.
 */
export interface SceneGenerationContext {
  schemaVersion: 1;
  projectId: string;
  projectRevision: number;
  scene: {
    id: string;
    title: string;
    summary: string;
    tone: string;
    narration: Scene['narration'];
  };
  beats: GenerationBeat[];
  /** First-reference order, with each referenced profile listed once. */
  referencedCharacters: GenerationCharacter[];
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

function formatCharacter(character: GenerationCharacter): string {
  const facts = [
    character.background && `Background: ${character.background}`,
    character.personality && `Personality: ${character.personality}`,
    character.voice && `Baseline voice: ${character.voice}`,
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
  const unresolvedReferences: SceneGenerationContext['unresolvedReferences'] = [];
  const beats: GenerationBeat[] = scene.beats.map((beat, index) => {
    const document = cloneJson(beat.document);
    const references: CharacterOccurrence[] = [];
    collectReferences(document, [], characterById, references);
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
      order: index + 1,
      document,
      readableText: cleanBlock(renderNode(document, characterById)),
      references,
    };
  });

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
    };
  });

  const sceneCopy = {
    id: scene.id,
    title: scene.title,
    summary: scene.summary,
    tone: scene.tone,
    narration: cloneJson(scene.narration),
  };
  const contextBlocks = [
    `Scene: ${scene.title}`,
    scene.summary.trim() && `Scene summary: ${scene.summary.trim()}`,
    scene.tone.trim() && `Scene tone: ${scene.tone.trim()}`,
    scene.narration.pointOfView.trim() && `Point of view: ${scene.narration.pointOfView.trim()}`,
    scene.narration.tense.trim() && `Tense: ${scene.narration.tense.trim()}`,
    scene.narration.instructions.trim() && `Narration guidance: ${scene.narration.instructions.trim()}`,
    referencedCharacters.length
      ? `Referenced character profiles:\n${referencedCharacters.map(formatCharacter).join('\n')}`
      : 'Referenced character profiles: none.',
    beats.length
      ? `Ordered beats:\n${beats.map(beat => `Beat ${beat.order}:\n${beat.readableText || '(empty)'}`).join('\n\n')}`
      : 'Ordered beats: none.',
    unresolvedReferences.length
      ? `Unresolved references:\n${unresolvedReferences.map(ref => `- ${ref.label} (profile unavailable; preserve this as an existing reference)`).join('\n')}`
      : '',
  ].filter((block): block is string => typeof block === 'string' && block.length > 0);

  return freezeDeep({
    schemaVersion: 1,
    projectId: project.projectId,
    projectRevision: project.revision,
    scene: sceneCopy,
    beats,
    referencedCharacters,
    unresolvedReferences,
    readableContext: contextBlocks.join('\n\n'),
  });
}
