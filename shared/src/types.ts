export interface Position {
  row: number;
  col: number;
}

export interface PuzzleDefinition {
  id: string;
  size: number;
  /** regions[row][col] = color-region id (0-based, one region per size) */
  regions: number[][];
}

export interface ValidationResult {
  valid: boolean;
  conflicts: PlacementConflict[];
}

export type ConflictReason = 'row' | 'col' | 'region' | 'adjacent';

export interface PlacementConflict {
  with: Position;
  reason: ConflictReason;
}
