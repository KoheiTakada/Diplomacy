import { canBuildFleetAtProvince } from '@/diplomacy/gameHelpers';
import { MINI_MAP_INITIAL_STATE } from '@/miniMap';

describe('canBuildFleetAtProvince', () => {
  it('内陸拠点では海軍を増産できない', () => {
    const board = { ...MINI_MAP_INITIAL_STATE };
    expect(canBuildFleetAtProvince(board, 'PAR')).toBe(false);
  });

  it('海に面した沿岸拠点では海軍を増産できる', () => {
    const board = { ...MINI_MAP_INITIAL_STATE };
    expect(canBuildFleetAtProvince(board, 'BRE')).toBe(true);
  });
});
