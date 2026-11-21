import { describe, expect, it } from 'vitest';
import { buildSceneGenerationContext } from './generation-context';
import { generationInputFingerprint } from './generation-fingerprint';
import { project } from '../test/fixtures';
import sharedBlocks from '../test/global-block-context.json';
import summaryBlocks from '../test/summary-board-context.json';

describe('scene generation input fingerprint', () => {
  it('keeps character icons out of generation context and the stale-draft fingerprint', () => {
    const baseline = buildSceneGenerationContext(sharedBlocks, 'scene');
    const decorated = structuredClone(sharedBlocks);
    decorated.characters = decorated.characters.map(character => ({ ...character, icon: 'crown' }));
    const context = buildSceneGenerationContext(decorated, 'scene');

    expect(context).toEqual(baseline);
    expect(JSON.stringify(context)).not.toContain('"icon"');
    expect(generationInputFingerprint(context, '')).toBe(generationInputFingerprint(baseline, ''));
  });

  it('keeps display-only preset colors out of the v2 context and fingerprint', () => {
    const baseline = buildSceneGenerationContext(sharedBlocks, 'scene');
    const colored = structuredClone(sharedBlocks);
    colored.tones = colored.tones.map(preset => ({ ...preset, color: '#1A2B3C' }));
    colored.emotions = colored.emotions.map(preset => ({ ...preset, color: '#D4E5F6' }));
    const context = buildSceneGenerationContext(colored, 'scene');

    expect(context.schemaVersion).toBe(2);
    expect(context).toEqual(baseline);
    expect(JSON.stringify(context)).not.toContain('"color"');
    expect(generationInputFingerprint(context, '')).toBe('5d9e08ad4bfe1a11');
  });

  it('resolves structured summary blocks while omitting an unrelated character and emotion both named Joy', () => {
    const context = buildSceneGenerationContext(summaryBlocks, 'scene');
    expect(context.summaryBoard.references.map(reference => reference.characterId)).toEqual(['maya', 'damian']);
    expect(context.referencedCharacters.map(character => character.name)).toEqual(['Maya', 'Damian']);
    expect(context.referencedPresets.map(preset => preset.id)).toEqual(['serious', 'tender']);
    expect(context.summaryBoard.readableText).toContain('[Maya][Emotion: Serious → Maya] stitches [Damian]');
    expect(context.summaryBoard.readableText).toContain('[Tone: Tender]');
    expect(context.readableContext).not.toContain('MUST NOT LEAK');
    expect(context.beats).toEqual([]);
    expect(generationInputFingerprint(context, '', 'prose')).toBe('ee4ac54030b293e5');
    expect(generationInputFingerprint(context, '', 'beats')).toBe('7d03989edc06ed20');
    expect(generationInputFingerprint(context, '', 'beats')).not.toBe(generationInputFingerprint(context, '', 'prose'));
    const oldContract = { ...context, schemaVersion: 1 } as unknown as typeof context;
    expect(generationInputFingerprint(oldContract, '', 'prose')).not.toBe(generationInputFingerprint(context, '', 'prose'));
    const unrelatedEdit = structuredClone(summaryBlocks); unrelatedEdit.characters[2].background = 'Changed unrelated background';
    expect(generationInputFingerprint(buildSceneGenerationContext(unrelatedEdit, 'scene'), '', 'beats')).toBe(generationInputFingerprint(context, '', 'beats'));
  });

  it('matches Rust for scene and inline references, defaults and Unicode', () => {
    const context = buildSceneGenerationContext(sharedBlocks, 'scene');
    expect(context.scene).toMatchObject({ tone: 'Tender', toneId: 'tender' });
    expect(context.beats[0].readableText).toContain('[Tone: Tense]');
    expect(context.beats[1].readableText).toBe('Rain falls.');
    expect(context.readableContext).toContain('Scene default tone: Tender');
    expect(context.readableContext).toContain('Default tone: Tender');
    expect(context.readableContext).toContain('Default emotion: Serious');
    expect(context.readableContext).not.toContain('inherited scene');
    expect(context.readableContext).toContain('[Emotion: Awe → Maya]');
    expect(context.readableContext).not.toContain('Must not leak');
    expect(context.referencedPresets.map(p => p.id)).toEqual(['tender', 'tense', 'awe', 'serious']);
    expect(generationInputFingerprint(context, '')).toBe('5d9e08ad4bfe1a11');
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

    expect(generationInputFingerprint(buildSceneGenerationContext(sample, 'scene-a'), '')).toBe('7c9879bcbe77e141');
  });
});
