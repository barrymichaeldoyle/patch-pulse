import type { UpdateType } from './types';

type RiskLevel = 'NONE' | 'LOW' | 'HIGH';

interface RiskAssessment {
  level: RiskLevel;
  callout: 'TIP' | 'NOTE' | 'CAUTION';
  description: string;
}

export function assessRisk(updateType: UpdateType): RiskAssessment {
  switch (updateType) {
    case 'patch':
      return {
        level: 'NONE',
        callout: 'TIP',
        description: 'Patch updates contain bug fixes only — safe to merge.',
      };
    case 'minor':
      return {
        level: 'LOW',
        callout: 'NOTE',
        description:
          'Minor updates add backwards-compatible features. Review the release notes before merging.',
      };
    case 'major':
      return {
        level: 'HIGH',
        callout: 'CAUTION',
        description:
          'Major updates may contain breaking API changes. Carefully review the release notes and test before merging.',
      };
    default: {
      const exhaustive: never = updateType;
      throw new Error(`Unknown update type: ${String(exhaustive)}`);
    }
  }
}
