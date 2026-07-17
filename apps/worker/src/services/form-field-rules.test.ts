import { describe, expect, it } from 'vitest';
import { matchingConditionalTagIds } from './form-field-rules.js';

describe('matchingConditionalTagIds', () => {
  it('一致・含む・回答ありの条件を判定し、同じタグを重複させない', () => {
    const result = matchingConditionalTagIds([
      { name: 'symptom', tagRules: [{ operator: 'equals', value: '冷え', tagId: 'cold' }, { operator: 'contains', value: '冷', tagId: 'cold' }] },
      { name: 'medicine', tagRules: [{ operator: 'not_empty', tagId: 'medicine' }] },
    ], { symptom: '冷え', medicine: ['薬A', '薬B'] });
    expect(result).toEqual(['cold', 'medicine']);
  });

  it('空欄や条件不一致ではタグを返さない', () => {
    expect(matchingConditionalTagIds([
      { name: 'answer', tagRules: [{ operator: 'not_empty', tagId: 'answered' }, { operator: 'contains', value: 'はい', tagId: 'yes' }] },
    ], { answer: '' })).toEqual([]);
  });
});
