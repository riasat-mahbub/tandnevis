import '../test/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import GenerationPanel from './GenerationPanel';
import type { GenerationPanelProps } from './GenerationPanel';

afterEach(cleanup);

function props(overrides: Partial<GenerationPanelProps> = {}): GenerationPanelProps {
  return {
    ready: true,
    hasSavedBeats: true,
    status: 'idle',
    draftText: '',
    currentFingerprint: 'input-current',
    requestFingerprint: undefined,
    onGenerate: vi.fn(),
    onStop: vi.fn(),
    onAccept: vi.fn(),
    onCopy: vi.fn(),
    onDiscard: vi.fn(),
    onRetry: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
}

describe('GenerationPanel', () => {
  it('keeps Generate disabled until ChatGPT is ready and offers a separate Settings action', () => {
    const p = props({ ready: false, hasSavedBeats: false });
    render(<GenerationPanel {...p}/>);

    expect(screen.getByRole('button', { name: 'Generate scene' })).toBeDisabled();
    expect(screen.getByText('Connect and verify ChatGPT in Settings to generate this scene.')).toBeVisible();
    const settings = screen.getByRole('button', { name: 'Open Settings' });
    expect(settings).toBeEnabled();
    fireEvent.click(settings);
    expect(p.onOpenSettings).toHaveBeenCalledOnce();
  });

  it('keeps Generate disabled for an empty scene even when the connection is ready', () => {
    render(<GenerationPanel {...props({ hasSavedBeats: false })}/>);

    expect(screen.getByRole('button', { name: 'Generate scene' })).toBeDisabled();
    expect(screen.getByText('Add a non-empty beat to describe this scene.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open Settings' })).toBeNull();
  });

  it('starts a ready scene and exposes Stop while its separate draft streams', () => {
    const p = props();
    const { rerender } = render(<GenerationPanel {...p}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Generate scene' }));
    expect(p.onGenerate).toHaveBeenCalledOnce();

    rerender(<GenerationPanel {...p} status="streaming" draftText="Maya steadied the needle."/>);
    expect(screen.getByRole('button', { name: 'Stop generating' })).toBeEnabled();
    expect(screen.getByText('Maya steadied the needle.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Accept draft' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(p.onStop).toHaveBeenCalledOnce();
  });

  it('offers Accept, Copy and Discard for a completed draft', () => {
    const p = props({ status: 'completed', draftText: 'Maya stitched the wound carefully.' });
    render(<GenerationPanel {...p}/>);

    fireEvent.click(screen.getByRole('button', { name: 'Accept draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onAccept).toHaveBeenCalledOnce();
    expect(p.onCopy).toHaveBeenCalledOnce();
    expect(p.onDiscard).toHaveBeenCalledOnce();
  });

  it('requires review before accepting a draft based on earlier direction', () => {
    const p = props({ status: 'completed', draftText: 'A draft from the earlier beats.', requestFingerprint: 'input-old' });
    render(<GenerationPanel {...p}/>);

    expect(screen.getByRole('alert')).toHaveTextContent('Based on earlier direction');
    const accept = screen.getByRole('button', { name: 'Accept draft' });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I reviewed this draft against the current scene' }));
    expect(accept).toBeEnabled();
  });

  it('requires review if scene prose changed after the request began', () => {
    const p = props({
      status: 'completed',
      draftText: 'A generated scene.',
      requestFingerprint: 'input-current',
      requestBaseProse: 'Earlier prose',
      currentProse: 'Edited prose',
    });
    render(<GenerationPanel {...p}/>);

    expect(screen.getByRole('alert')).toHaveTextContent('direction or prose changed');
    const accept = screen.getByRole('button', { name: 'Accept draft' });
    expect(accept).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I reviewed this draft against the current scene' }));
    fireEvent.click(accept);
    expect(p.onAccept).toHaveBeenCalledWith(true);
  });

  it('preserves interrupted partial output and allows a new attempt or copy', () => {
    const p = props({ status: 'interrupted', draftText: 'The partial scene remains here.' });
    render(<GenerationPanel {...p}/>);

    expect(screen.getByRole('status')).toHaveTextContent('Draft recovered after interruption');
    expect(screen.getByText('The partial scene remains here.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Generate a new attempt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy partial' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(p.onRetry).toHaveBeenCalledOnce();
    expect(p.onCopy).toHaveBeenCalledOnce();
    expect(p.onDiscard).toHaveBeenCalledOnce();
  });
});
