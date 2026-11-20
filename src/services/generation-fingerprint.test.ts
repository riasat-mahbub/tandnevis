import { describe, expect, it } from 'vitest';
import { buildSceneGenerationContext } from './generation-context';
import { generationInputFingerprint } from './generation-fingerprint';
import { project } from '../test/fixtures';
import sharedBlocks from '../test/global-block-context.json';

describe('scene generation input fingerprint', () => {
  it('matches Rust for scene and beat tone, targeted emotion, defaults and Unicode', () => {
    const context = buildSceneGenerationContext(sharedBlocks, 'scene');
    expect(context.beats.map(b => [b.tone, b.toneSource])).toEqual([['Tense', 'beat'], ['Tender', 'scene']]);
    expect(context.readableContext).toContain('[Emotion: Awe → Maya]');
    expect(context.readableContext).not.toContain('Must not leak');
    expect(context.referencedPresets.map(p => p.id)).toEqual(['tender', 'tense', 'awe', 'serious']);
    expect(generationInputFingerprint(context, '')).toBe('873d7120b011db30');
  });
  it('ignores project revision but changes with scene input or default guidance', () => {
    const original = project();
    const context = buildSceneGenerationContext(original, 'scene-1');
    const fingerprint = generationInputFingerprint(context, 'Keep it warm.');

    const otherRevision = structuredClone(original);
    otherRevision.revision += 1;
    expect(generationInputFingerprint(buildSceneGenerationContext(otherRevision, 'scene-1'), 'Keep it warm.')).toBe(fingerprint);

    const changedBeat = structuredClone(original);
    changedBeat.scenes[0].beats[0].text = 'The door crashes open.';
    changedBeat.scenes[0].beats[0].document.content![0].content![0].text = 'The door crashes open.';
    expect(generationInputFingerprint(buildSceneGenerationContext(changedBeat, 'scene-1'), 'Keep it warm.')).not.toBe(fingerprint);
    expect(generationInputFingerprint(context, 'Write tersely.')).not.toBe(fingerprint);
  });

  it('matches the native Rust fingerprint for the shared character-reference vector', () => {
    const sample = project();
    sample.projectId = 'project-a';
    sample.revision = 12;
    sample.scenes = [{
      id: 'scene-a', chapterId: 'chapter-a', title: 'Infirmary', summary: 'Maya treats Damian.', tone: 'Tense and tender', prose: '', toneId: '',
      narration: { pointOfView: 'Third person limited', tense: 'Past', instructions: 'Stay close to Maya.' },
      beats: [{
        id: 'beat-a', text: 'editor text mirror', document: {
          type: 'doc', content: [{ type: 'paragraph', content: [
            { type: 'characterReference', attrs: { characterId: 'maya', label: 'Old Maya', emotion: 'serious', delivery: 'quiet' } },
            { type: 'text', text: ' repairs the damage.' },
          ] }],
        },
      }],
    }];
    sample.characters = [
      { id: 'maya', name: 'Maya', background: 'A careful apprentice healer.', personality: 'Protective.', voice: 'Measured and dry.', archived: true, defaultToneId: '', defaultEmotionId: '' },
      { id: 'unreferenced', name: 'Unrelated private profile', background: 'Secret profile facts.', voice: '', personality: '', archived: false, defaultToneId: '', defaultEmotionId: '' },
    ];

    expect(generationInputFingerprint(buildSceneGenerationContext(sample, 'scene-a'), '')).toBe('3637622f5f45db80');
  });
});
