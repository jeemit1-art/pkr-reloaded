import type {CSSProperties} from 'react';

// Rank denotes a position in the currently selected standings sort, not a
// player identity or cash/chip denomination. Gold, silver, bronze then a
// deliberately distinct casino palette; all foregrounds meet 4.5:1 contrast.
export const RANK_CHIP_COLOURS = [
 // fill, contrasting striped edge, number
 ['#C79A32','#FFF0B4','#211A11'], // 01 gold
 ['#8496AA','#EFF6FC','#101D2B'], // 02 silver
 ['#A66237','#F9D4AB','#FFFFFF'], // 03 bronze
 ['#972F4D','#F8C5D3','#FFFFFF'], // 04 ruby
 ['#5C3D87','#DAC8F6','#FFFFFF'], // 05 violet
 ['#A7441D','#F7D1A3','#FFFFFF'], // 06 copper
 ['#126748','#AFF9D2','#FFFFFF'], // 07 jade
 ['#12647C','#AEECFA','#FFFFFF'], // 08 teal
 ['#28559B','#B8D5FF','#FFFFFF'], // 09 cobalt
 ['#343D50','#E4E9F1','#FFFFFF'], // 10 charcoal
 ['#7C375F','#F1C5E2','#FFFFFF'], // 11 plum
 ['#54682E','#DCE6AD','#FFFFFF'], // 12 olive
 ['#9F4659','#F6C4CF','#FFFFFF'], // 13 rose
 ['#08725A','#B5F5E0','#FFFFFF'], // 14 emerald
 ['#3F4C8E','#D0D6FF','#FFFFFF'], // 15 indigo
 ['#852B48','#EFC8D8','#FFFFFF'], // 16 claret
 ['#984D25','#F8D7B4','#FFFFFF'], // 17 rust
 ['#185D70','#BEEEF4','#FFFFFF'], // 18 ocean
 ['#654282','#E7D4F3','#FFFFFF'], // 19 amethyst
 ['#344D76','#C2D5ED','#FFFFFF'], // 20 navy
] as const;

// Styles are shared across every selectable theme and colour mode.
// Ranks beyond 20 repeat, separated by 20 positions (not every 3 positions).
export function rankChipStyle(rank:number):CSSProperties{
 const safe=Number.isFinite(rank)&&rank>=1?Math.floor(rank):1;
 const [fill,edge,ink]=RANK_CHIP_COLOURS[(safe-1)%RANK_CHIP_COLOURS.length];
 return {
  '--pkr-rank-fill':fill,
  '--pkr-rank-edge':edge,
  '--pkr-rank-ink':ink,
 } as CSSProperties;
}
