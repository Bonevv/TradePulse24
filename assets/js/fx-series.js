/* Свещите на една двойка в една графика + индикаторите към тях. */
(function (FX) {
  "use strict";
  const I = FX.ind;

  class Series {
    constructor(pair, tf, bars) {
      this.pair = pair;
      this.tf = tf;
      this.info = FX.PAIRS[pair];
      this.tfc = FX.TIMEFRAMES[tf];
      this.sec = this.tfc.seconds;
      this.pip = this.info.pip;
      this.buf = this.tfc.buffer_pips * this.pip * (this.info.buf_scale || 1);
      const n = (this.n = bars.length);
      this.t = new Array(n); this.o = new Array(n); this.h = new Array(n); this.l = new Array(n); this.c = new Array(n);
      this.hour = new Array(n); this.minute = new Array(n); this.weekday = new Array(n); this.date = new Array(n);
      for (let i = 0; i < n; i++) {
        const b = bars[i];
        this.t[i] = b[0]; this.o[i] = b[1]; this.h[i] = b[2]; this.l[i] = b[3]; this.c[i] = b[4];
        const d = FX.local(b[0]);
        this.hour[i] = d.hour; this.minute[i] = d.minute; this.weekday[i] = d.weekday; this.date[i] = d.date;
      }
      this.peers = {};
      this.memo = {};
      this._cache = {};
      this._align = {};
      this._base = false;
    }

    /** Основните индикатори - смятат се при първо поискване. */
    base() {
      if (!this._base) {
        const { h, l, c } = this;
        this._sma5 = I.sma(c, 5); this._sma20 = I.sma(c, 20); this._sma50 = I.sma(c, 50);
        this._ema20 = I.ema(c, 20);
        this._atr = I.atr(h, l, c, 14);
        [this._adx, this._pdi, this._mdi] = I.dmi(h, l, c, 14);
        this._psar = I.psarTrend(h, l);
        this._base = true;
      }
      return this;
    }
    get sma5() { return this.base()._sma5; }
    get sma20() { return this.base()._sma20; }
    get sma50() { return this.base()._sma50; }
    get ema20() { return this.base()._ema20; }
    get atr() { return this.base()._atr; }
    get adx() { return this.base()._adx; }
    get pdi() { return this.base()._pdi; }
    get mdi() { return this.base()._mdi; }
    get psar() { return this.base()._psar; }

    fmt(price) { return price.toFixed(this.info.digits); }
    peer(tf) { return this.peers[tf]; }

    /** За всяка свещ i: индексът на последната ЗАВЪРШЕНА свещ от графика tf (или -1). */
    align(tf) {
      if (!this._align[tf]) {
        const p = this.peers[tf], out = new Array(this.n);
        let j = -1;
        for (let i = 0; i < this.n; i++) {
          const end = this.t[i] + this.sec;
          while (j + 1 < p.n && p.t[j + 1] + p.sec <= end) j++;
          out[i] = j;
        }
        this._align[tf] = out;
      }
      return this._align[tf];
    }

    /** Индикатори, които се смятат само при нужда и се пазят. */
    get(name, ...args) {
      const key = name + "|" + args.join(",");
      if (!(key in this._cache)) {
        const { o, h, l, c } = this;
        let v;
        switch (name) {
          case "kama": v = I.kama(c, ...args); break;
          case "demarker": v = I.demarker(h, l, ...args); break;
          case "rvi": v = I.rvi(o, h, l, c, ...args); break;
          case "ema": v = I.ema(c, args[0]); break;
          case "sma": v = I.sma(c, args[0]); break;
          case "rsi": v = I.rsi(c, args[0]); break;
          case "bb": v = I.bollinger(c, args[0], args[1]); break;
          case "atr": v = I.atr(h, l, c, args[0]); break;
          case "st": v = I.supertrend(h, l, c, args[0], args[1]); break;
          case "ut": v = I.utBot(c, I.atr(h, l, c, args[1]), args[0]); break;
          case "ichi": v = I.ichimoku(h, l); break;
          case "sqz": v = I.squeeze(h, l, c); break;
          case "adx": v = I.dmi(h, l, c, args[0]); break;
          case "macd": v = I.macd(c, args[0], args[1], args[2]); break;
          case "stoch": v = I.stoch(h, l, c, args[0], args[1], args[2]); break;
          case "cci": v = I.cci(h, l, c, args[0]); break;
          case "wpr": v = I.wpr(h, l, c, args[0]); break;
          case "mom": v = I.momentum(c, args[0]); break;
          case "ao": v = I.awesome(h, l); break;
          case "donchian": v = I.donchian(h, l, args[0]); break;
          case "keltner": v = I.keltner(h, l, c, args[0], args[1]); break;
          case "heikin": v = I.heikin(o, h, l, c); break;
          case "chandelier": v = I.chandelier(h, l, c, args[0], args[1]); break;
          case "ssl": v = I.ssl(h, l, args[0]); break;
          case "psar": v = I.psarTrend(h, l, args[0], args[1]); break;
          case "session_range": v = this._sessionRange(args[0], args[1]); break;
          default: throw new Error("Непознат индикатор: " + name);
        }
        this._cache[key] = v;
      }
      return this._cache[key];
    }

    /** За всеки ден: най-високата и най-ниската цена между startHour и endHour (местно време). */
    _sessionRange(startHour, endHour) {
      const days = new Map();
      for (let i = 0; i < this.n; i++) {
        if (this.hour[i] >= startHour && this.hour[i] < endHour) {
          const d = days.get(this.date[i]);
          if (!d) days.set(this.date[i], [this.h[i], this.l[i], 1]);
          else { d[0] = Math.max(d[0], this.h[i]); d[1] = Math.min(d[1], this.l[i]); d[2] += 1; }
        }
      }
      return days;
    }
  }

  FX.Series = Series;
})(self.FX = self.FX || {});
