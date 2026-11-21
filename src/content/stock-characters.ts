/** Optional starting points. A profile enters a project only after an explicit Add action. */
export interface StockCharacter {
  name: string;
  role: string;
  background: string;
  personality: string;
  voice: string;
  defaultToneName?: string;
  defaultEmotionName?: string;
}

export const stockCharacters: StockCharacter[] = [
  {
    name: 'Maya', role: 'The guarded medic',
    background: 'A student who learned first aid while caring for family.',
    personality: 'Competent, practical, and reluctant to admit concern.',
    voice: 'Blunt, dry, and concise; care comes through instructions.',
    defaultEmotionName: 'Serious',
  },
  {
    name: 'Damian', role: 'The proud rival',
    background: 'Frequently arrives with injuries and an inadequate explanation.',
    personality: 'Defensive about dependence; notices kindness more than he admits.',
    voice: 'Terse and combative when vulnerable; unexpectedly direct when sincere.',
    defaultEmotionName: 'Serious',
  },
  {
    name: 'Joy', role: 'The observant friend',
    background: "Knows everyone's habits and keeps the group connected.",
    personality: 'Warm, curious, and occasionally prone to overstepping.',
    voice: 'Conversational, quick questions, and vivid details; talks around awkward silences.',
    defaultToneName: 'Playful',
  },
  {
    name: 'Elias', role: 'The charming liar',
    background: 'Survives by improvising convincing explanations.',
    personality: 'Sociable and resourceful, but frightened of being known too well.',
    voice: 'Smooth and specific; answers a nearby question when the real one hurts.',
    defaultToneName: 'Wry',
  },
  {
    name: 'Vera', role: 'The tired mentor',
    background: 'Has solved similar problems before, at a personal cost.',
    personality: 'Patient with effort and impatient with posturing.',
    voice: 'Measured and economical; asks questions that expose assumptions.',
    defaultEmotionName: 'Serious',
  },
  {
    name: 'Kit', role: 'The anxious planner',
    background: 'Usually prepared because uncertainty is difficult.',
    personality: 'Loyal and observant, prone to rehearsing outcomes.',
    voice: 'Precise and qualified; becomes startlingly clear during an actual emergency.',
  },
];
