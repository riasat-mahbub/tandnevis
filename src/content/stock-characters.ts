/** Static starting points for a character draft. These are never project records. */
export interface StockCharacterTemplate {
  id: string;
  title: string;
  background: string;
  personality: string;
  voice: string;
}

export const stockCharacterTemplates: StockCharacterTemplate[] = [
  {
    id: 'guarded-medic', title: 'The guarded medic',
    background: 'Learned to care for others through necessity, often putting practical help before personal feelings.',
    personality: 'Competent, practical, and reluctant to admit concern.',
    voice: 'Blunt, dry, and concise; care comes through instructions.',
  },
  {
    id: 'proud-rival', title: 'The proud rival',
    background: 'Frequently arrives with injuries and an inadequate explanation.',
    personality: 'Defensive about dependence; notices kindness more than they admit.',
    voice: 'Terse and combative when vulnerable; unexpectedly direct when sincere.',
  },
  {
    id: 'observant-friend', title: 'The observant friend',
    background: "Knows everyone's habits and keeps the group connected.",
    personality: 'Warm, curious, and occasionally prone to overstepping.',
    voice: 'Conversational, quick questions, and vivid details; talks around awkward silences.',
  },
  {
    id: 'charming-liar', title: 'The charming liar',
    background: 'Survives by improvising convincing explanations.',
    personality: 'Sociable and resourceful, but frightened of being known too well.',
    voice: 'Smooth and specific; answers a nearby question when the real one hurts.',
  },
  {
    id: 'tired-mentor', title: 'The tired mentor',
    background: 'Has solved similar problems before, at a personal cost.',
    personality: 'Patient with effort and impatient with posturing.',
    voice: 'Measured and economical; asks questions that expose assumptions.',
  },
  {
    id: 'anxious-planner', title: 'The anxious planner',
    background: 'Usually prepared because uncertainty is difficult.',
    personality: 'Loyal and observant, prone to rehearsing outcomes.',
    voice: 'Precise and qualified; becomes startlingly clear during an actual emergency.',
  },
];
