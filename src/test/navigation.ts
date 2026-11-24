import { fireEvent, screen } from '@testing-library/react';

export function openChapter(title = 'The beginning') {
  fireEvent.click(screen.getByRole('button', { name: `Open chapter ${title}` }));
}

export function openArrival() {
  if (!screen.queryByRole('button', { name: /^Arrival .*Open scene/ })) openChapter();
  fireEvent.click(screen.getByRole('button', { name: /^Arrival .*Open scene/ }));
}

export function openLibrary(name: string) {
  if (screen.queryByRole('dialog', { name: 'Story Library' })) {
    const all = screen.queryByRole('button', { name: 'All definitions' });
    if (all) fireEvent.click(all);
  } else fireEvent.click(screen.getByLabelText('Library'));
  fireEvent.click(screen.getByRole('button', { name }));
}
