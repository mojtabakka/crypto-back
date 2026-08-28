export class ScoreNormalizer {
  // ==========================================
  // Positive / Negative Limits
  // ==========================================

  private readonly POSITIVE_MAX = 105;

  private readonly NEGATIVE_MAX = 90;

  // ==========================================
  // Normalize
  // ==========================================

  normalize(score: number): number {
    // ------------------------------------------
    // Positive
    // ------------------------------------------

    if (score > 0) {
      const normalized = (score / this.POSITIVE_MAX) * 100;

      return Number(Math.min(normalized, 100).toFixed(2));
    }

    // ------------------------------------------
    // Negative
    // ------------------------------------------

    if (score < 0) {
      const normalized = (score / this.NEGATIVE_MAX) * 100;

      return Number(Math.max(normalized, -100).toFixed(2));
    }

    // ------------------------------------------
    // Neutral
    // ------------------------------------------

    return 0;
  }
}
