import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import type { ProjectSnapshot } from './project';
import { buildSceneGenerationContext } from './generation-context';

function ref(characterId: string, label: string, emotion = '', delivery = ''): JSONContent {
  return { type: 'characterReference', attrs: { characterId, label, emotion, delivery } };
}

function paragraph(...content: Array<JSONContent | string>): JSONContent {
  return {
    type: 'paragraph',
    content: content.map(entry => typeof entry === 'string' ? { type: 'text', text: entry } : entry),
  };
}

function sceneDocument(...paragraphs: JSONContent[]): JSONContent {
  return { type: 'doc', content: paragraphs };
}

function sampleProject(): ProjectSnapshot {
  return {
    projectId: 'project-1', title: 'The infirmary story', revision: 12,
    chapters: [{ id: 'chapter-1', title: 'At school', sceneIds: ['scene-1', 'scene-2'] }],
    scenes: [
      {
        id: 'scene-1', chapterId: 'chapter-1', title: 'School Infirmary',
        summary: 'Maya stitches Damian’s wounds after a fight.', tone: 'Tender with awkward humor', prose: '', toneId: '',
        narration: { pointOfView: 'Third person limited', tense: 'Past', instructions: 'Stay close to Damian’s attention.' },
        beats: [
          { id: 'beat-1', document: sceneDocument(paragraph(ref('maya-id', 'Old Maya label', 'serious'), ' is stitching ', ref('damian-id', 'Damian'), '’s wounds.')), text: 'Maya is stitching Damian’s wounds.' },
          { id: 'beat-2', document: sceneDocument(paragraph(ref('damian-id', 'Damian', 'pained'), ' flinches and complains a little.')), text: 'Damian flinches and complains a little.' },
          { id: 'beat-3', document: sceneDocument(paragraph(ref('maya-id', 'Maya', 'serious'), ' tells him to hold still and stop bleeding on her floor.')), text: 'Maya tells Damian to hold still.' },
          { id: 'beat-4', document: sceneDocument(paragraph(ref('damian-id', 'Damian', 'awe'), ' stops complaining and looks at Maya’s face, thinking she is beautiful.')), text: 'Damian looks at Maya.' },
          { id: 'beat-5', document: sceneDocument(paragraph(ref('maya-id', 'Maya', 'angry'), ' notices Damian staring and asks if there is something in her face.')), text: 'Maya notices him staring.' },
          { id: 'beat-6', document: sceneDocument(paragraph(ref('damian-id', 'Damian', 'awe'), ' says there is nothing; he just likes her face. ', ref('maya-id', 'Maya', 'embarrassed'), ' calls him an idiot.')), text: 'Damian compliments Maya.' },
        ],
      },
      { id: 'scene-2', chapterId: 'chapter-1', title: 'Elsewhere', summary: 'A different scene.', tone: '', prose: '', toneId: '', narration: { pointOfView: '', tense: '', instructions: '' }, beats: [{ id: 'beat-other', document: sceneDocument(paragraph('Do not send this.')), text: 'Do not send this.' }] },
    ],
    characters: [
      { id: 'maya-id', name: 'Maya', background: 'A guarded student medic.', personality: 'Practical and sharp.', voice: 'Dry, clipped sentences.', archived: false, defaultToneId: '', defaultEmotionId: '' },
      { id: 'damian-id', name: 'Damian', background: 'A stubborn transfer student.', personality: 'Serious and hostile by default.', voice: 'Blunt, guarded speech.', archived: true, defaultToneId: '', defaultEmotionId: '' },
      { id: 'unreferenced-id', name: 'Nora', background: 'Must not leak.', personality: 'Must not leak.', voice: 'Must not leak.', archived: false, defaultToneId: '', defaultEmotionId: '' },
    ],
    tones: [], emotions: [], starterTypes: [],
    trash: [{ id: 'trash-1', kind: 'scene', title: 'Deleted secret', deletedAtRevision: 9, payload: { secret: 'Do not send this.' } }],
    importSources: [{ id: 'source-1', markdown: 'private import source', importedAtRevision: 2 }],
    canUndo: true, canRedo: false,
  };
}

describe('scene generation context', () => {
  it('captures one selected scene, ordered beats and referenced profiles with local direction', () => {
    const project = sampleProject();
    const context = buildSceneGenerationContext(project, 'scene-1');

    expect(context.scene).toEqual({
      id: 'scene-1', title: 'School Infirmary', summary: 'Maya stitches Damian’s wounds after a fight.',
      summaryDocument: sceneDocument(paragraph('Maya stitches Damian’s wounds after a fight.'), paragraph('Scene tone: Tender with awkward humor')),
      tone: 'Tender with awkward humor', toneId: '',
      narration: { pointOfView: 'Third person limited', tense: 'Past', instructions: 'Stay close to Damian’s attention.' },
    });
    expect(context.beats.map(beat => [beat.id, beat.order])).toEqual([
      ['beat-1', 1], ['beat-2', 2], ['beat-3', 3], ['beat-4', 4], ['beat-5', 5], ['beat-6', 6],
    ]);
    expect(context.referencedCharacters.map(character => character.id)).toEqual(['maya-id', 'damian-id']);
    expect(context.referencedCharacters[1]).toMatchObject({ name: 'Damian', archived: true, voice: 'Blunt, guarded speech.' });
    expect(context.beats[0].references[0]).toMatchObject({ characterId: 'maya-id', label: 'Maya', emotion: 'serious', profileResolved: true });
    expect(context.beats[0].document.content?.[0].content?.[0]).toEqual(ref('maya-id', 'Old Maya label', 'serious'));
    expect(context.beats[5].references.map(reference => [reference.label, reference.emotion])).toEqual([
      ['Damian', 'awe'], ['Maya', 'embarrassed'],
    ]);
    expect(context.readableContext).toContain('Scene default tone: Tender with awkward humor');
    expect(context.schemaVersion).toBe(2);
    expect(context.readableContext).toContain('Baseline voice: Blunt, guarded speech.');
    expect(context.readableContext).toContain('This profile is archived; it remains attached to an existing beat reference.');
    expect(context.readableContext).toContain('[Maya — emotion: serious]');
    expect(context.readableContext).toContain('[Damian — emotion: awe]');
    expect(context.readableContext).not.toContain('Elsewhere');
    expect(context.readableContext).not.toContain('Nora');
    expect(context.readableContext).not.toContain('private import source');
    expect(context.readableContext).not.toContain('Deleted secret');
    expect(JSON.stringify(context)).not.toContain('Do not send this.');
    expect(context.unresolvedReferences).toEqual([]);
  });

  it('keeps ordinary unlinked names as prose and handles a beat with no references', () => {
    const project = sampleProject();
    project.scenes[0].beats = [{
      id: 'plain-beat', document: sceneDocument(paragraph('Maya remembers Damian but neither is present.')),
      text: 'Maya remembers Damian but neither is present.',
    }];
    const context = buildSceneGenerationContext(project, 'scene-1');

    expect(context.referencedCharacters).toEqual([]);
    expect(context.beats[0].references).toEqual([]);
    expect(context.beats[0].readableText).toBe('Maya remembers Damian but neither is present.');
    expect(context.readableContext).toContain('Referenced character profiles: none.');
    expect(context.readableContext).not.toContain('[Maya]');
  });

  it('retains a missing profile occurrence and reports it without inventing profile facts', () => {
    const project = sampleProject();
    project.scenes[0].beats = [{
      id: 'orphan-beat', document: sceneDocument(paragraph('Then ', ref('removed-id', 'Former extra', 'afraid'), ' leaves.')),
      text: 'Then Former extra leaves.',
    }];
    const context = buildSceneGenerationContext(project, 'scene-1');

    expect(context.referencedCharacters).toEqual([]);
    expect(context.unresolvedReferences).toEqual([{ beatId: 'orphan-beat', path: [0, 1], characterId: 'removed-id', label: 'Former extra' }]);
    expect(context.beats[0].references[0]).toMatchObject({ profileResolved: false, profileArchived: false, emotion: 'afraid' });
    expect(context.readableContext).toContain('[Former extra — emotion: afraid]');
    expect(context.readableContext).toContain('profile unavailable');
  });

  it('returns a detached deep-frozen snapshot and rejects a stale scene ID', () => {
    const project = sampleProject();
    const sourceText = project.scenes[0].beats[0].document.content?.[0].content?.[1];
    const context = buildSceneGenerationContext(project, 'scene-1');

    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.beats)).toBe(true);
    expect(Object.isFrozen(context.beats[0].document.content)).toBe(true);
    expect(() => { (context.beats[0].references as unknown as unknown[]).push({}); }).toThrow();
    if (sourceText?.type === 'text') sourceText.text = 'changed source';
    expect(context.beats[0].readableText).toContain('is stitching');
    expect(() => buildSceneGenerationContext(project, 'deleted-scene')).toThrow('selected scene');
  });
});

it('keeps emotion and tone references freeform, ordered, and independent of legacy defaults', () => {
  const project = sampleProject();
  const preset = (id: string, name: string) => ({ id, name, meaning: `${name} meaning`, guidance: `${name} guidance`, example: '', color: '#1A2B3C', archived: false, revision: 0 });
  project.tones = [preset('scene-default', 'Scene default'), preset('tone-a', 'Tender'), preset('tone-b', 'Tense')];
  project.emotions = [preset('emotion-default', 'Serious'), preset('emotion-a', 'Awe'), preset('emotion-b', 'Embarrassed')];
  project.scenes[0].toneId = 'scene-default';
  project.scenes[0].summaryDocument = sceneDocument(paragraph(
    { type: 'characterReference', attrs: { characterId: 'maya-id', occurrenceId: 'maya-old', label: 'Maya' } },
    { type: 'emotionReference', attrs: { emotionId: 'emotion-a', label: 'Old Awe', targetOccurrenceId: 'maya-old' } },
    ' considers it. ',
    { type: 'emotionReference', attrs: { emotionId: 'emotion-b', label: 'Embarrassed' } },
    ' ',
    { type: 'toneReference', attrs: { toneId: 'tone-a', label: 'Tender' } },
    ' then ',
    { type: 'toneReference', attrs: { toneId: 'tone-b', label: 'Tense' } },
  ));
  project.scenes[0].beats = [{
    id: 'freeform-beat',
    document: sceneDocument(paragraph(
      { type: 'toneReference', attrs: { toneId: 'tone-b', label: 'Tense' } },
      ' First cue. ',
      { type: 'emotionReference', attrs: { emotionId: 'emotion-a', label: 'Awe' } },
      ' ',
      { type: 'toneReference', attrs: { toneId: 'tone-a', label: 'Tender' } },
    )),
    text: 'First cue.',
  }];
  project.characters[0].defaultEmotionId = 'emotion-default';

  const context = buildSceneGenerationContext(project, 'scene-1');
  const summaryNodes = context.summaryBoard.document.content?.[0].content;
  expect(summaryNodes?.[1]?.attrs?.targetOccurrenceId).toBe('maya-old');
  expect(context.summaryBoard.readableText).toContain('[Emotion: Awe → Maya]');
  expect(context.summaryBoard.readableText).toContain('[Emotion: Embarrassed]');
  expect(context.summaryBoard.readableText).toContain('[Tone: Tender] then [Tone: Tense]');
  expect(context.beats[0].readableText).toBe('[Tone: Tense] First cue. [Emotion: Awe] [Tone: Tender]');
  expect(context.scene).toMatchObject({ tone: 'Scene default', toneId: 'scene-default' });
  expect(context.readableContext).toContain('Scene default tone: Scene default');
  expect(context.readableContext).not.toContain('inherited scene');
  expect(context.referencedPresets.map(item => item.id)).toEqual([
    'emotion-a', 'emotion-b', 'tone-a', 'tone-b', 'scene-default', 'emotion-default',
  ]);
  expect(context.referencedPresets.every(preset => !('color' in preset))).toBe(true);

  const unresolvedLegacy = structuredClone(project);
  const emotion = unresolvedLegacy.scenes[0].summaryDocument!.content![0].content![1];
  emotion.attrs!.targetOccurrenceId = 'removed-occurrence';
  const unresolved = buildSceneGenerationContext(unresolvedLegacy, 'scene-1');
  expect(unresolved.summaryBoard.document.content?.[0].content?.[1].attrs?.targetOccurrenceId).toBe('removed-occurrence');
  expect(unresolved.summaryBoard.readableText).toContain('[Emotion: Awe → character reference unavailable]');
});

it('keeps a list and the paragraph after it separated in one beat', () => {
  const snapshot = sampleProject();
  snapshot.scenes[0].beats[0].document = {
    type: 'doc',
    content: [
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Then after.' }] },
    ],
  };

  expect(buildSceneGenerationContext(snapshot, 'scene-1').beats[0].readableText).toBe('• First\nThen after.');
});
