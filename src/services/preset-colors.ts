import type { CSSProperties } from 'react';
import type { PresetKind } from './project';
import starterPresets from '../content/starter-presets.json';

export type PresetColorFamilyId = 'rose' | 'gold' | 'coral' | 'violet' | 'blue' | 'teal' | 'slate';
export type PresetLike = { name: string; color?: string | null };
export interface PresetColorFamily {
  id: PresetColorFamilyId;
  name: string;
  color: string;
}
export interface PresetColorGroup<T extends PresetLike> {
  id: PresetColorFamilyId | 'custom';
  name: string;
  color: string;
  presets: T[];
}

export const PRESET_COLOR_FAMILIES: readonly PresetColorFamily[] = [
  { id: 'rose', name: 'Connection', color: '#BE527A' },
  { id: 'gold', name: 'Positive energy', color: '#B98116' },
  { id: 'coral', name: 'Conflict', color: '#C85343' },
  { id: 'violet', name: 'Unease', color: '#8260AD' },
  { id: 'blue', name: 'Vulnerability', color: '#527FB0' },
  { id: 'teal', name: 'Discovery', color: '#25877F' },
  { id: 'slate', name: 'Focus', color: '#657080' },
] as const;

const SLATE = PRESET_COLOR_FAMILIES.find(family => family.id === 'slate')!;
const familyByColor = new Map(PRESET_COLOR_FAMILIES.map(family => [family.color.toLowerCase(), family]));
const starterCatalog = starterPresets as {
  tones: { name: string; color?: string }[];
  emotions: { name: string; color?: string }[];
};

function catalogDefault(kind: PresetKind, name: string): string {
  const normalizedName = name.trim().toLocaleLowerCase();
  const catalog = kind === 'emotion' ? starterCatalog.emotions : starterCatalog.tones;
  const catalogColor = catalog.find(preset => preset.name.trim().toLocaleLowerCase() === normalizedName)?.color;
  return normalizeHex(catalogColor) ?? SLATE.color;
}

function normalizeHex(value: string | null | undefined): string | undefined {
  const candidate = value?.trim();
  return candidate && /^#[\da-f]{6}$/i.test(candidate) ? candidate.toUpperCase() : undefined;
}

/** Resolve an explicit preset color, or the catalog color for older uncolored definitions. */
export function effectiveColor(kind: PresetKind, preset: PresetLike): string {
  return normalizeHex(preset.color) ?? catalogDefault(kind, preset.name);
}

function rgb(hex: string): [number, number, number] {
  const normalized = normalizeHex(hex) ?? SLATE.color;
  return [1, 3, 5].map(index => Number.parseInt(normalized.slice(index, index + 2), 16)) as [number, number, number];
}

function toHex([red, green, blue]: [number, number, number]): string {
  return `#${[red, green, blue].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function mix(first: string, second: string, secondWeight: number): string {
  const a = rgb(first), b = rgb(second);
  return toHex(a.map((channel, index) => channel * (1 - secondWeight) + b[index] * secondWeight) as [number, number, number]);
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: string): number {
  const [red, green, blue] = rgb(color).map(linearChannel);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG contrast ratio for two six-digit hex colors. */
export function contrastRatio(first: string, second: string): number {
  const luminance = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (luminance[0] + 0.05) / (luminance[1] + 0.05);
}

function readableInk(background: string): string {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#FFFFFF') ? '#000000' : '#FFFFFF';
}

/** Inline styles consumed by preset-colored shelf entries and editor atoms. */
export function presetColorStyle(color: string): CSSProperties {
  const base = normalizeHex(color) ?? SLATE.color;
  const light = mix(base, '#FFFFFF', 0.86);
  const dark = mix(base, '#17191E', 0.56);
  return {
    '--preset-bg-light': light,
    '--preset-ink-light': readableInk(light),
    '--preset-bg-dark': dark,
    '--preset-ink-dark': readableInk(dark),
  } as CSSProperties;
}

/** Group rows by their effective palette color, keeping custom colors in a final bucket. */
export function groupPresetsByColor<T extends PresetLike>(kind: PresetKind, presets: readonly T[]): PresetColorGroup<T>[] {
  const grouped = new Map<PresetColorFamilyId | 'custom', T[]>();
  for (const preset of presets) {
    const color = effectiveColor(kind, preset).toLowerCase();
    const family = familyByColor.get(color);
    const id = family?.id ?? 'custom';
    const rows = grouped.get(id) ?? [];
    rows.push(preset);
    grouped.set(id, rows);
  }
  const groups: PresetColorGroup<T>[] = PRESET_COLOR_FAMILIES.flatMap(family => {
    const rows = grouped.get(family.id);
    return rows?.length ? [{ id: family.id, name: family.name, color: family.color, presets: rows }] : [];
  });
  const custom = grouped.get('custom');
  if (custom?.length) groups.push({ id: 'custom', name: 'Custom colors', color: '', presets: custom });
  return groups;
}
