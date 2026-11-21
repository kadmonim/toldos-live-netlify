// The games' pictures, in the same language as the bottom bar's icons: simple line drawings (2px, rounded
// ends, one colour) on a soft tile, each game in one of the app's tone pairs (like the profile's tiles).
const icon = (paths) => `<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ART = {
  // Who's this?: a photo of someone, with a question mark
  who: icon(`<rect x="3" y="3.5" width="13" height="16" rx="2.5"/><circle cx="9.5" cy="9.3" r="2.4"/><path d="M5.6 16.4c.6-2 2-3.1 3.9-3.1s3.3 1.1 3.9 3.1"/>
    <circle cx="17.8" cy="17.2" r="4.2" fill="var(--tile)"/><path d="M16.5 16.2c.1-.7.6-1.1 1.3-1.1s1.3.5 1.3 1.1c0 .9-1.3 1-1.3 1.9"/><circle cx="17.8" cy="19.4" r=".35" fill="currentColor"/>`),
  // Birthdays & anniversaries: a cake with a candle
  birthdays: icon(`<path d="M4 20.5h16"/><rect x="5" y="13" width="14" height="7.5" rx="2"/><path d="M5 16c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0"/>
    <path d="M12 13V9.5"/><path d="M12 4c1.1 1.2 1.4 2.1.9 2.8-.5.6-1.3.6-1.8 0-.5-.7-.2-1.6.9-2.8z" fill="currentColor"/>`),
  // Family card: a card with a family on it
  family: icon(`<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><circle cx="8" cy="10.5" r="2"/><path d="M4.9 16c.4-1.6 1.6-2.6 3.1-2.6s2.7 1 3.1 2.6"/><path d="M14 10h4.5M14 13h4.5M14 16h2.5"/>`),
  // Whose child?: a parent and a child
  kids: icon(`<circle cx="8.5" cy="5.5" r="2.5"/><path d="M4.5 20.5v-6c0-2.4 1.8-4.2 4-4.2s4 1.8 4 4.2v6"/><circle cx="16.8" cy="10.4" r="2"/><path d="M13.8 20.5v-3.3c0-1.9 1.3-3.2 3-3.2s3 1.3 3 3.2v3.3"/>`),
  // Sons- & daughters-in-law: two wedding rings, one with a diamond
  inlaws: icon(`<circle cx="9" cy="15" r="5.5"/><circle cx="15" cy="15" r="5.5"/><path d="M13.2 5.2l1-1.7h1.6l1 1.7L15 8z"/>`),
};
// Each game's tile and ink: the app's tone pairs (src/main.js TONES).
const TONE = { who: ['#EEE8FF', '#7C5CBF'], birthdays: ['#FFF0F3', '#E0436A'], family: ['#E8F4FF', '#2A6FA8'], kids: ['#FFF5E0', '#A87418'], inlaws: ['#FFE4F4', '#9A4E9D'] };
export const GAME_ART = Object.fromEntries(Object.entries(ART).map(([k, svg]) => [k,
  `<span class="game-tile" style="--tile:${TONE[k][0]};background:${TONE[k][0]};color:${TONE[k][1]}">${svg}</span>`]));
