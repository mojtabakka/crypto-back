export const SIGNAL_THRESHOLDS = {
  price: {
    up: 1,
    strongUp: 3,

    down: -1,
    strongDown: -3,
  },

  openInterest: {
    up: 2,
    strongUp: 5,

    down: -2,
    strongDown: -5,
  },

  volume: {
    up: 20,
    strongUp: 50,

    down: -20,
    strongDown: -50,
  },

  funding: {
    positive: 0.0001,
    high: 0.0003,
  },
};
