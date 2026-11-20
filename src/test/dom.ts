import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

window.scrollTo = vi.fn();
HTMLElement.prototype.scrollIntoView = vi.fn();
Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
Range.prototype.getBoundingClientRect = vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }));
if (!window.matchMedia) window.matchMedia = vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(), media: '', onchange: null }));
