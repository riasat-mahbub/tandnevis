import { describe, expect, it } from 'vitest';
import starterPresets from '../content/starter-presets.json';
import { contrastRatio, effectiveColor, groupPresetsByColor, PRESET_COLOR_FAMILIES, presetColorStyle } from './preset-colors';

describe('preset color families', () => {
  it('assigns the catalog defaults to all 42 starter definitions', () => {
    const catalog = starterPresets as {
      emotions: { name: string; color: string }[];
      tones: { name: string; color: string }[];
    };
    expect(catalog.emotions).toHaveLength(24);
    expect(catalog.tones).toHaveLength(18);
    for (const preset of catalog.emotions) {
      expect(effectiveColor('emotion', { name: preset.name }), `emotion ${preset.name}`).toBe(preset.color);
    }
    for (const preset of catalog.tones) {
      expect(effectiveColor('tone', { name: preset.name }), `tone ${preset.name}`).toBe(preset.color);
    }
    expect(PRESET_COLOR_FAMILIES).toHaveLength(7);
    expect(new Set(PRESET_COLOR_FAMILIES.map(family => family.color)).size).toBe(7);
  });

  it('uses explicit colors and returns to catalog defaults after reset', () => {
    expect(effectiveColor('emotion', { name: 'Awe' })).toBe('#25877F');
    expect(effectiveColor('emotion', { name: 'Awe', color: '' })).toBe('#25877F');
    expect(effectiveColor('emotion', { name: 'Awe', color: '#ff00aa' })).toBe('#FF00AA');
    expect(effectiveColor('tone', { name: 'unknown legacy name' })).toBe('#657080');
    expect(effectiveColor('tone', { name: 'unknown legacy name', color: 'hotpink' })).toBe('#657080');
  });

  it('groups matching palette colors by family and other explicit colors together', () => {
    const groups = groupPresetsByColor('emotion', [
      { id: 'awe', name: 'Awe' },
      { id: 'surprised', name: 'Surprised', color: '#25877F' },
      { id: 'custom', name: 'Custom', color: '#FF00AA' },
    ]);
    expect(groups.map(group => [group.id, group.name, group.presets.map(preset => preset.id)])).toEqual([
      ['teal', 'Discovery', ['awe', 'surprised']],
      ['custom', 'Custom colors', ['custom']],
    ]);
  });
});

describe('preset color styles', () => {
  it.each([
    ...PRESET_COLOR_FAMILIES.map(family => family.color),
    '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#39FF14', '#FF00AA', '#00FFFF', '#777777',
  ])('keeps readable ink for color %s in light and dark themes', color => {
    const style = presetColorStyle(color) as Record<string, string>;
    expect(contrastRatio(style['--preset-bg-light'], style['--preset-ink-light'])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(style['--preset-bg-dark'], style['--preset-ink-dark'])).toBeGreaterThanOrEqual(4.5);
    expect(style['--preset-bg-light']).toMatch(/^#[\dA-F]{6}$/);
    expect(style['--preset-bg-dark']).toMatch(/^#[\dA-F]{6}$/);
  });
});
