import '../test/dom';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import SceneProseEditor from './SceneProseEditor';

afterEach(cleanup);

it('keeps accepted scene prose separate from beat directions and exposes edits', () => {
  const onChange = vi.fn();
  render(<SceneProseEditor value="Maya tied off the final stitch." disabled={false} onChange={onChange}/>);

  const prose = screen.getByRole('textbox', { name: 'Scene prose' });
  expect(prose).toHaveValue('Maya tied off the final stitch.');
  expect(screen.getByText(/your beats remain separate direction/i)).toBeVisible();
  fireEvent.change(prose, { target: { value: 'Maya checked the bandage.' } });
  expect(onChange).toHaveBeenCalledWith('Maya checked the bandage.');
});
