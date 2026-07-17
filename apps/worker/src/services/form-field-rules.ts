export interface FormTagRule {
  operator: 'equals' | 'contains' | 'not_empty';
  value?: string;
  tagId: string;
}

export interface FormFieldRuleDefinition {
  name: string;
  tagRules?: FormTagRule[];
}

function answerText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join('、').trim() : String(value ?? '').trim();
}

export function matchingConditionalTagIds(
  fields: FormFieldRuleDefinition[],
  data: Record<string, unknown>,
): string[] {
  const matches = new Set<string>();
  for (const field of fields) {
    const answer = answerText(data[field.name]);
    for (const rule of field.tagRules || []) {
      if (!rule?.tagId) continue;
      const expected = String(rule.value ?? '').trim();
      const matched = rule.operator === 'not_empty'
        ? answer.length > 0
        : rule.operator === 'equals'
          ? answer.localeCompare(expected, 'ja', { sensitivity: 'accent' }) === 0
          : rule.operator === 'contains' && expected.length > 0 && answer.includes(expected);
      if (matched) matches.add(rule.tagId);
    }
  }
  return [...matches];
}
