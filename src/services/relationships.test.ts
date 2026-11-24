import { describe, expect, it } from 'vitest';
import source from '../test/relationship-context.json';
import fingerprints from '../test/relationship-context-fingerprints.json';
import type { ProjectSnapshot } from './project';
import { relationshipStates } from './relationships';
import { buildSceneGenerationContext } from './generation-context';
import { generationInputFingerprint } from './generation-fingerprint';

const fixture = () => structuredClone(source) as ProjectSnapshot;
describe('scene relationship continuity', () => {
  it('replays prior changes, preserves asymmetry, and separates the current outcome from entry', () => {
    const states = relationshipStates(fixture(), 'scene');
    expect(states.before.find(r => r.id === 'prior-change')?.status).toBe('planned');
    expect(states.before.some(r => r.id === 'current-change')).toBe(false);
    expect(states.after.some(r => r.id === 'current-change')).toBe(true);
    expect(states.before.some(r => r.id === 'reverse-baseline')).toBe(true);
    expect(JSON.stringify(states)).not.toContain('FUTURE TRUST');
  });
  it('recalculates on reorder, ignores deleted scenes, and restores their changes with the scene', () => {
    const project = fixture();
    project.chapters[0].sceneIds = ['scene', 'earlier', 'later'];
    expect(relationshipStates(project, 'scene').before.some(r => r.id === 'prior-change')).toBe(false);
    project.chapters[0].sceneIds = ['earlier', 'scene', 'later'];
    project.scenes = project.scenes.filter(s => s.id !== 'earlier');
    expect(relationshipStates(project, 'scene').before.some(r => r.id === 'prior-change')).toBe(false);
    project.scenes.unshift(fixture().scenes.find(s => s.id === 'earlier')!);
    expect(relationshipStates(project, 'scene').before.some(r => r.id === 'prior-change')).toBe(true);
  });
  it('applies entry corrections and explicit clears without reviving a relationship next scene', () => {
    const project = fixture();
    project.relationshipChanges!.push({ ...project.relationshipChanges![0], id: 'correction', sceneId: 'scene', phase: 'before', description: 'Entry correction.' });
    expect(relationshipStates(project, 'scene').before.find(r => r.id === 'correction')?.description).toBe('Entry correction.');
    project.relationshipChanges!.push({ ...project.relationshipChanges![0], id: 'clear', sceneId: 'scene', phase: 'after', description: '', status: 'planned' });
    expect(relationshipStates(project, 'later').before.find(r => r.id === 'clear')).toMatchObject({ description: '', status: 'planned' });
  });
  it('sends a compact briefing for relevant people and fingerprints exactly the native input', () => {
    const project = fixture(), context = buildSceneGenerationContext(project, 'scene');
    expect(context.relationships?.before).toHaveLength(2);
    expect(context.readableContext).toContain('Changes intended in this scene:');
    expect(context.readableContext).not.toContain('PRIVATE OFFSTAGE');
    expect(context.readableContext).not.toContain('FUTURE TRUST');
    expect(Object.isFrozen(context.relationships?.before[0])).toBe(true);
    expect(generationInputFingerprint(context, '')).toBe(fingerprints.prose);
    expect(generationInputFingerprint(context, '', 'beats')).toBe(fingerprints.beats);
  });
  it('includes explicit offstage context and detects upstream edits while ignoring future edits', () => {
    const project = fixture();
    const initial = generationInputFingerprint(buildSceneGenerationContext(project, 'scene'), '');
    project.relationshipChanges!.find(r => r.id === 'future-change')!.description = 'A later revision';
    expect(generationInputFingerprint(buildSceneGenerationContext(project, 'scene'), '')).toBe(initial);
    project.relationshipChanges!.find(r => r.id === 'prior-change')!.description = 'A relevant earlier revision';
    expect(generationInputFingerprint(buildSceneGenerationContext(project, 'scene'), '')).not.toBe(initial);
    project.relationshipCast = { scene: ['iris'] };
    const context = buildSceneGenerationContext(project, 'scene');
    expect(context.referencedCharacters.some(c => c.id === 'iris')).toBe(true);
    expect(context.readableContext).toContain('PRIVATE OFFSTAGE');
  });
});
