import type { ProjectSnapshot } from './project';

export interface RelationshipChange {
  id: string;
  sourceId: string;
  targetId: string;
  kind: 'attitude' | 'family';
  mutual: boolean;
  sceneId: string;
  phase: 'before' | 'after';
  description: string;
  status: 'planned' | 'established';
}
export interface RelationshipContext {
  before: RelationshipChange[];
  after: RelationshipChange[];
  changes: RelationshipChange[];
}

export function relationshipChangeText(project: Pick<ProjectSnapshot, 'characters'>, change: RelationshipChange): string {
  const name = (id: string) => project.characters.find(c => c.id === id)?.name ?? 'Unknown character';
  return `[Relationship change: ${name(change.sourceId)} ${change.mutual ? '↔' : '→'} ${name(change.targetId)} · ${change.phase === 'before' ? 'At scene entry' : 'By scene end'} · ${change.kind} · ${change.description.trim() || 'End relationship'} · ${change.status}]`;
}
export const relationshipKey = (r: Pick<RelationshipChange, 'sourceId' | 'targetId' | 'kind' | 'mutual'>) =>
  JSON.stringify([r.sourceId, r.targetId, r.kind, r.mutual]);
const compareRelationships = (a: RelationshipChange, b: RelationshipChange) => relationshipKey(a) < relationshipKey(b) ? -1 : relationshipKey(a) > relationshipKey(b) ? 1 : 0;

export function orderedScenes(project: ProjectSnapshot) {
  return project.chapters.flatMap(chapter => chapter.sceneIds.flatMap(id => {
    const scene = project.scenes.find(scene => scene.id === id);
    return scene ? [scene] : [];
  }));
}

/** Replay authored changes only. Reading order is explicit; later scenes never leak backwards. */
export function relationshipStates(project: ProjectSnapshot, sceneId = ''): RelationshipContext {
  const state = new Map<string, RelationshipChange>();
  const apply = (id: string, phase: RelationshipChange['phase']) => {
    for (const change of project.relationshipChanges ?? []) {
      if (change.sceneId === id && change.phase === phase) state.set(relationshipKey(change), change);
    }
  };
  const snapshot = () => [...state.values()].sort(compareRelationships);
  apply('', 'before');
  if (!sceneId) return { before: snapshot(), after: snapshot(), changes: [] };
  for (const scene of orderedScenes(project)) {
    apply(scene.id, 'before');
    if (scene.id === sceneId) {
      const before = snapshot();
      apply(scene.id, 'after');
      return { before, after: snapshot(), changes: (project.relationshipChanges ?? []).filter(r => r.sceneId === sceneId && r.phase === 'after').sort(compareRelationships) };
    }
    apply(scene.id, 'after');
  }
  throw new Error('The selected scene is no longer in this project.');
}

export function sceneRelationshipCharacters(project: ProjectSnapshot, sceneId: string, referencedIds: string[]) {
  const ids = new Set([...referencedIds, ...(project.relationshipCast?.[sceneId] ?? [])]);
  for (const change of project.relationshipChanges ?? []) if (change.sceneId === sceneId) {
    ids.add(change.sourceId); ids.add(change.targetId);
  }
  return [...ids];
}

export function relationshipContext(project: ProjectSnapshot, sceneId: string, ids: string[]): RelationshipContext | undefined {
  if (!project.relationshipChanges?.length) return undefined;
  const participants = new Set(ids);
  const states = relationshipStates(project, sceneId);
  const relevant = (r: RelationshipChange) => participants.has(r.sourceId) && participants.has(r.targetId);
  const result = { before: states.before.filter(relevant), after: states.after.filter(relevant), changes: states.changes.filter(relevant) };
  return result.before.length || result.after.length || result.changes.length ? result : undefined;
}

export function readableRelationships(project: ProjectSnapshot, context: RelationshipContext): string {
  const name = (id: string) => project.characters.find(c => c.id === id)?.name ?? 'Unknown character';
  const line = (r: RelationshipChange) => `- ${name(r.sourceId)} ${r.mutual ? '↔' : '→'} ${name(r.targetId)} [${r.kind}; ${r.status}]: ${r.description || '(relationship cleared)'}`;
  return [
    'Relationship continuity (story reading order):',
    'Before this scene — entering state; planned entries are provisional, not established facts:',
    context.before.map(line).join('\n') || '(No relationships specified.)',
    'After this scene — authored target state; write the transition, do not treat this as already true at entry:',
    context.after.map(line).join('\n') || '(No relationships specified.)',
    'Changes intended in this scene:',
    context.changes.map(line).join('\n') || '(No lasting relationship changes specified.)',
    'Attitudes are directional. Cooperation does not imply friendship or reciprocal trust. Author knowledge is not shared character knowledge. Scene summary and beats describe the encounter. Prose acceptance does not establish planned changes.',
  ].join('\n');
}
