import type { SVGProps } from 'react';
import { resolveCharacterIcon, resolveCharacterIconId } from '../content/character-icons';

interface CharacterIconProps extends Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> {
  icon?: string;
  size?: number;
}

export default function CharacterIcon({ icon, size = 16, className, ...props }: CharacterIconProps) {
  const Icon = resolveCharacterIcon(icon);
  const resolvedId = resolveCharacterIconId(icon);
  return <Icon
    data-character-icon={resolvedId}
    aria-hidden="true"
    focusable="false"
    width={size}
    height={size}
    className={className}
    {...props}
  />;
}
