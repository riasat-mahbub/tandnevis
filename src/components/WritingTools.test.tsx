import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import WritingTools from './WritingTools';
import { project } from '../test/fixtures';

afterEach(cleanup);

it('finds references beyond the initial selection without including archived definitions', () => {
  const snapshot = project();
  snapshot.characters = Array.from({ length: 9 }, (_, index) => ({ ...snapshot.characters[0], id: `character-${index}`, name: `Writer ${index}`, archived: index === 8 }));
  const onInsert = vi.fn();
  render(<WritingTools project={snapshot} locked={false} onManage={vi.fn()} onInsert={onInsert}/>);
  expect(screen.queryByRole('button', { name: 'Character: Writer 7' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
  expect(screen.getByRole('button', { name: 'Character: Writer 7' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Show fewer' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Writer 7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Character: Writer 7' }));
  expect(onInsert).toHaveBeenCalledWith('character', snapshot.characters[7]);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Writer 8' } });
  expect(screen.queryByRole('button', { name: 'Character: Writer 8' })).toBeNull();
});
