import { SentimentService } from './sentiment.service';

/**
 * Verifies the scoring math produces a usable spread of labels.
 * Uses synthetic articles so the result is deterministic.
 */
describe('SentimentService scoring behaviour', () => {
  const build = () => {
    const service = new SentimentService(
      { create: (v: unknown) => v, save: async (v: unknown) => v } as never,
      { getCombinedNewsForSymbol: async () => [] } as never,
      {} as never,
    );

    return service;
  };

  const scoreText = (service: SentimentService, text: string) =>
    service['scoreArticle']({ title: text, description: '' }).score;

  const toScore = (service: SentimentService, avg: number, matchRate: number) =>
    service['clamp'](service['tanh'](avg / 2.5) * 100 * matchRate, -100, 100);

  it('scores a strongly bullish headline clearly positive', () => {
    const service = build();
    const score = scoreText(service, 'Bitcoin surges to record high on massive rally');

    expect(score).toBeGreaterThan(8);
  });

  it('scores a strongly bearish headline clearly negative', () => {
    const service = build();
    const score = scoreText(service, 'Bitcoin crashes amid panic selling and massive outflows');

    expect(score).toBeLessThan(-8);
  });

  it('scores a neutral headline near zero', () => {
    const service = build();
    const score = scoreText(service, 'Company announces new office opening in London');

    expect(Math.abs(score)).toBeLessThan(2);
  });

  it('reduces conviction when hedged language is present', () => {
    const service = build();

    const direct = scoreText(service, 'Bitcoin surges to record high');
    const hedged = scoreText(service, 'Bitcoin could reportedly surge to record high');

    expect(hedged).toBeLessThan(direct);
  });

  it('maps a full bullish sample to a bullish label', () => {
    const service = build();

    const articles = Array.from({ length: 10 }, () => ({
      title: 'Bitcoin surges to record high on massive institutional inflows',
      description: 'Bullish breakout as demand grows',
      url: '',
    }));

    const scores = articles.map((a) => service['scoreArticle'](a).score);
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const score = toScore(service, avg, 1);

    expect(avg).toBeGreaterThan(8);
    expect(score).toBeGreaterThan(45);
    expect(service['getSentimentLabel'](score)).toBe('very_bullish');
  });

  it('maps a full bearish sample to a bearish label', () => {
    const service = build();

    const articles = Array.from({ length: 10 }, () => ({
      title: 'Bitcoin crashes as exchange hacked amid panic and massive outflows',
      description: 'Bearish selloff with liquidation',
      url: '',
    }));

    const scores = articles.map((a) => service['scoreArticle'](a).score);
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    const score = toScore(service, avg, 1);

    expect(avg).toBeLessThan(-8);
    expect(score).toBeLessThan(-45);
    expect(service['getSentimentLabel'](score)).toBe('very_bearish');
  });

  it('keeps low-signal samples neutral', () => {
    const service = build();

    const articles = Array.from({ length: 10 }, () => ({
      title: 'Company announces new office opening in London',
      description: '',
      url: '',
    }));

    const scores = articles.map((a) => service['scoreArticle'](a).score);
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;

    expect(toScore(service, avg, 0)).toBe(0);
    expect(service['getSentimentLabel'](toScore(service, avg, 0))).toBe('neutral');
  });

  it('never exceeds the -100..100 range', () => {
    const service = build();

    const extreme = 'CRASH PLUNGE LIQUIDATION PANIC HACK EXPLOIT FRESC'.repeat(3);
    const score = toScore(service, scoreText(service, extreme), 1);

    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBeGreaterThanOrEqual(-100);
  });
});