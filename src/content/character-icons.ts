import {
  Bird, BookOpen, BriefcaseBusiness, Coins, Compass, Drama, Feather, Fingerprint,
  Flame, FlaskConical, Gem, GraduationCap, HatGlasses, Heart, KeyRound, Moon,
  Music, Search, Shield, Skull, Smile, Sparkles, Star, Swords, Theater, Trophy,
  UserRound, WandSparkles, Glasses, HandHeart, Crown, Ghost,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface CharacterIconDefinition {
  id: string;
  label: string;
  Icon: LucideIcon;
}

export const characterIcons: CharacterIconDefinition[] = [
  { id: 'user', label: 'Person', Icon: UserRound },
  { id: 'crown', label: 'Crown', Icon: Crown },
  { id: 'coins', label: 'Coins', Icon: Coins },
  { id: 'swords', label: 'Swords', Icon: Swords },
  { id: 'shield', label: 'Shield', Icon: Shield },
  { id: 'book-open', label: 'Open book', Icon: BookOpen },
  { id: 'feather', label: 'Feather', Icon: Feather },
  { id: 'heart', label: 'Heart', Icon: Heart },
  { id: 'sparkles', label: 'Sparkles', Icon: Sparkles },
  { id: 'wand-sparkles', label: 'Wand', Icon: WandSparkles },
  { id: 'skull', label: 'Skull', Icon: Skull },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'fingerprint', label: 'Fingerprint', Icon: Fingerprint },
  { id: 'key-round', label: 'Key', Icon: KeyRound },
  { id: 'drama', label: 'Comedy and tragedy masks', Icon: Drama },
  { id: 'glasses', label: 'Glasses', Icon: Glasses },
  { id: 'graduation-cap', label: 'Graduation cap', Icon: GraduationCap },
  { id: 'trophy', label: 'Trophy', Icon: Trophy },
  { id: 'flame', label: 'Flame', Icon: Flame },
  { id: 'theater', label: 'Theater', Icon: Theater },
  { id: 'flask-conical', label: 'Flask', Icon: FlaskConical },
  { id: 'compass', label: 'Compass', Icon: Compass },
  { id: 'ghost', label: 'Ghost', Icon: Ghost },
  { id: 'smile', label: 'Smile', Icon: Smile },
  { id: 'music', label: 'Music', Icon: Music },
  { id: 'gem', label: 'Gem', Icon: Gem },
  { id: 'star', label: 'Star', Icon: Star },
  { id: 'moon', label: 'Moon', Icon: Moon },
  { id: 'hat-glasses', label: 'Disguise', Icon: HatGlasses },
  { id: 'hand-heart', label: 'Helping hand', Icon: HandHeart },
  { id: 'briefcase', label: 'Briefcase', Icon: BriefcaseBusiness },
  { id: 'bird', label: 'Bird', Icon: Bird },
];

const iconById = new Map(characterIcons.map(item => [item.id, item.Icon]));

export function resolveCharacterIconId(icon?: string): string {
  return icon && iconById.has(icon) ? icon : 'user';
}

export function resolveCharacterIcon(icon?: string): LucideIcon {
  return iconById.get(resolveCharacterIconId(icon)) || UserRound;
}
