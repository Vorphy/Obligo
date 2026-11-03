/* Silnik obliczeń obligacji skarbowych (detalicznych).
 * Działa w przeglądarce (window.BondEngine) i w Node (module.exports).
 *
 * Założenia modelu:
 *  - zakup w pierwszym dniu okresu odsetkowego bieżącej emisji,
 *  - 1 obligacja = 100 zł nominału, odsetki liczone na 1 obligację i zaokrąglane do grosza,
 *  - okresy miesięczne (ROR/DOR): liczba dni / 365; okresy roczne: pełna stopa roczna,
 *  - inflacja i stopa referencyjna NBP są stałe przez cały horyzont (założenie użytkownika),
 *  - podatek Belki 19% od odsetek (pomniejszonych o opłatę), 0% w IKE/IKZE,
 *  - przy horyzoncie dłuższym niż okres obligacji środki z wykupu są zamieniane na nową
 *    emisję tego samego typu (po cenie zamiany) z takimi samymi parametrami jak obecna oferta,
 *  - przy horyzoncie krótszym - przedterminowy wykup z opłatą wg zasad z obligacjeskarbowe.pl.
 */
(function (root) {
  'use strict';

  const TYPES = {
    OTS: { name: '3-miesięczne', term: 3,   period: 3,  kind: 'fixed', mode: 'end',        family: false },
    ROR: { name: 'roczne',       term: 12,  period: 1,  kind: 'ref',   mode: 'payout',     family: false },
    DOR: { name: '2-letnie',     term: 24,  period: 1,  kind: 'ref',   mode: 'payout',     family: false },
    TOS: { name: '3-letnie',     term: 36,  period: 12, kind: 'fixed', mode: 'capitalize', family: false },
    COI: { name: '4-letnie',     term: 48,  period: 12, kind: 'infl',  mode: 'payout',     family: false },
    ROS: { name: '6-letnie rodzinne',  term: 72,  period: 12, kind: 'infl', mode: 'capitalize', family: true },
    EDO: { name: '10-letnie',    term: 120, period: 12, kind: 'infl',  mode: 'capitalize', family: false },
    ROD: { name: '12-letnie rodzinne', term: 144, period: 12, kind: 'infl', mode: 'capitalize', family: true },
  };
  const ORDER = ['OTS', 'ROR', 'DOR', 'TOS', 'COI', 'ROS', 'EDO', 'ROD'];
  const BELKA = 0.19;

  const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
  const trunc2 = (x) => Math.floor(x * 100 + 1e-9) / 100;
  const DAY = 86400000;

  function parseDate(s) {
    if (s) {
      const [y, m, d] = s.split('-').map(Number);
      return Date.UTC(y, m - 1, d);
    }
    const n = new Date();
    return Date.UTC(n.getFullYear(), n.getMonth(), 1);
  }
  function addMonths(t, m) {
    const d = new Date(t);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate());
  }

  /** Model jednej obligacji (100 zł nominału) danego typu.
   *  A = { infl: %, ref: %, tax: 0..1 } */
  function bondModel(bond, A) {
    const T = TYPES[bond.code];
    const P = T.period;
    const nPeriods = T.term / P;
    const start = parseDate(bond.periodFrom || bond.saleFrom);
    const dt = (m) => addMonths(start, m);
    const days = (a, b) => (dt(b) - dt(a)) / DAY;
    const tax = A.tax;
    const fee = bond.fee || 0;

    const rates = [];
    for (let k = 0; k < nPeriods; k++) {
      let r;
      if (k === 0 || T.kind === 'fixed') r = bond.firstRate;
      else if (T.kind === 'ref') r = Math.max(0, A.ref) + bond.margin;
      else r = Math.max(0, A.infl) + bond.margin; // ujemna inflacja liczona jako 0
      rates.push(r / 100);
    }

    // wartość obligacji na początku każdego okresu (dla kapitalizowanych)
    const V = [100];
    // odsetki za okres (dla wypłacanych)
    const coupon = [];
    for (let k = 0; k < nPeriods; k++) {
      if (T.mode === 'capitalize') V.push(round2(V[k] * (1 + rates[k])));
      else if (T.mode === 'end') coupon.push(round2(100 * rates[k] * P / 12));
      else if (P === 12) coupon.push(round2(100 * rates[k]));
      else coupon.push(round2(100 * rates[k] * days(k * P, (k + 1) * P) / 365));
    }

    const taxOf = (x) => round2(Math.max(0, x) * tax);

    return {
      code: bond.code, T, rates, V, coupon, fee,
      rateAtAge(age) { return rates[Math.min(nPeriods - 1, Math.floor(age / P))]; },

      /** Wypłata odsetek w miesiącu `age` (tylko obligacje z wypłatą odsetek, przed wykupem). */
      payoutAt(age) {
        if (T.mode !== 'payout' || age <= 0 || age % P !== 0) return null;
        const gross = coupon[age / P - 1];
        const t = taxOf(gross);
        return { gross, tax: t, net: gross - t };
      },

      /** Kwota z wykupu w terminie (bez ostatniego kuponu, który zwraca payoutAt). */
      maturity() {
        let interest = 0;
        if (T.mode === 'capitalize') interest = V[nPeriods] - 100;
        else if (T.mode === 'end') interest = coupon[0];
        const t = taxOf(interest);
        return { gross: 100 + interest, interest, fee: 0, tax: t, net: round2(100 + interest - t) };
      },

      /** Przedterminowy wykup po `age` miesiącach (0 < age < term). */
      redeem(age) {
        if (T.mode === 'end') return { gross: 100, interest: 0, fee: 0, tax: 0, net: 100 };
        const k = Math.floor(age / P);
        const into = age - k * P;
        let acc, feeTaken;
        if (T.mode === 'capitalize') {
          const part = into === 0 ? 0 : trunc2(V[k] * rates[k] * days(k * P, age) / days(k * P, (k + 1) * P));
          acc = round2(V[k] - 100 + part);
          feeTaken = Math.min(fee, acc); // opłata tylko z narosłych odsetek
        } else {
          if (into === 0) acc = 0;
          else if (P === 12) acc = trunc2(100 * rates[k] * days(k * P, age) / days(k * P, (k + 1) * P));
          else acc = trunc2(100 * rates[k] * days(k * P, age) / 365);
          // 1. okres: opłata do wysokości odsetek; kolejne: w pełnej wysokości (także z kapitału)
          feeTaken = k === 0 ? Math.min(fee, acc) : fee;
        }
        const t = taxOf(acc - feeTaken);
        return { gross: 100 + acc, interest: acc, fee: feeTaken, tax: t, net: round2(100 + acc - feeTaken - t) };
      },
    };
  }

  /** Symulacja portfela jednego typu obligacji na horyzoncie H miesięcy.
   *  opts = { amount, H, infl, ref, ike, reinvest, swap } */
  function simulate(bond, opts) {
    const T = TYPES[bond.code];
    const A = { infl: opts.infl, ref: opts.ref, tax: opts.ike ? 0 : BELKA };
    const M = bondModel(bond, A);
    const price = bond.price || 100;
    const swapPrice = bond.swapPrice || price;
    const firstPrice = opts.swap && bond.swapPrice ? bond.swapPrice : price;

    let cash = opts.amount;
    const n0 = Math.floor(cash / firstPrice + 1e-9);
    cash = round2(cash - n0 * firstPrice);
    const lots = n0 > 0 ? [{ start: 0, n: n0 }] : [];
    const tot = { interestGross: 0, tax: 0, fee: 0, payouts: 0, rollovers: 0, bought: n0 };
    const timeline = [];

    const liquidation = (t) => {
      let v = cash;
      for (const l of lots) v += l.n * M.redeem(t - l.start).net;
      return round2(v);
    };
    timeline.push({ t: 0, value: opts.amount, bonds: n0, rate: M.rates[0], payouts: 0 });

    for (let t = 1; t <= opts.H; t++) {
      let incomeCash = 0;
      for (let i = lots.length - 1; i >= 0; i--) {
        const l = lots[i];
        const age = t - l.start;
        const p = M.payoutAt(age);
        if (p) {
          incomeCash += l.n * p.net;
          tot.interestGross += l.n * p.gross; tot.tax += l.n * p.tax; tot.payouts += l.n * p.net;
        }
        if (age === T.term) {
          const m = M.maturity();
          tot.interestGross += l.n * m.interest; tot.tax += l.n * m.tax;
          let proceeds = l.n * m.net;
          lots.splice(i, 1);
          if (t < opts.H) { // zamiana na nową emisję
            const k = Math.floor(proceeds / swapPrice + 1e-9);
            if (k > 0) { lots.push({ start: t, n: k }); tot.rollovers += 1; tot.bought += k; }
            proceeds -= k * swapPrice;
          }
          cash += proceeds;
        }
      }
      cash = round2(cash + incomeCash);
      if (opts.reinvest && t < opts.H && T.mode === 'payout' && cash >= price) {
        const k = Math.floor(cash / price + 1e-9);
        lots.push({ start: t, n: k }); tot.bought += k;
        cash = round2(cash - k * price);
      }
      if (t < opts.H) {
        const nb = lots.reduce((s, l) => s + l.n, 0);
        const age = lots.length ? t - lots[0].start : 0;
        timeline.push({ t, value: liquidation(t), bonds: nb, rate: lots.length ? M.rateAtAge(Math.max(0, age - 1)) : null, payouts: round2(tot.payouts) });
      }
    }

    // koniec horyzontu: przedterminowy wykup tego, co jeszcze nie zapadło
    // "wcześniejszy wykup" = horyzont nie jest wielokrotnością okresu obligacji
    // (małe partie dokupione z kuponów też są wykupywane, ale nie zmieniają tej oceny)
    const early = opts.H % T.term !== 0;
    for (const l of lots) {
      const r = M.redeem(opts.H - l.start);
      tot.interestGross += l.n * r.interest; tot.tax += l.n * r.tax; tot.fee += l.n * r.fee;
      cash += l.n * r.net;
    }
    const final = round2(cash);
    timeline.push({ t: opts.H, value: final, bonds: 0, rate: null, payouts: round2(tot.payouts) });

    const years = opts.H / 12;
    const profit = round2(final - opts.amount);
    const cagr = opts.amount > 0 ? Math.pow(final / opts.amount, 1 / years) - 1 : 0;
    const realFinal = final / Math.pow(1 + opts.infl / 100, years);
    return {
      code: bond.code, series: bond.series, model: M, final, profit, cagr,
      realFinal: round2(realFinal), realProfit: round2(realFinal - opts.amount),
      early, invested: opts.amount, bonds0: n0, leftover: round2(opts.amount - n0 * firstPrice),
      totals: {
        interestGross: round2(tot.interestGross), tax: round2(tot.tax), fee: round2(tot.fee),
        payouts: round2(tot.payouts), rollovers: tot.rollovers, bought: tot.bought,
      },
      timeline,
    };
  }

  /* ---------- Limit dla obligacji rodzinnych (800+) ---------- */
  const BENEFIT = [
    { from: [2016, 4], amount: 500 }, // program 500+ od 1.04.2016
    { from: [2024, 1], amount: 800 }, // 800+ od 1.01.2024
  ];
  const ym = (y, m) => y * 12 + (m - 1);

  /** birth, from: 'YYYY-MM'; now: Date. Zwraca sumę świadczeń należnych do bieżącego miesiąca. */
  function childLimit({ birth, from, used, now }) {
    if (!birth) return null;
    const [by, bm] = birth.split('-').map(Number);
    const nowYm = ym(now.getFullYear(), now.getMonth() + 1);
    const birthYm = ym(by, bm);
    const programStart = ym(2016, 4);
    let startYm = Math.max(birthYm, programStart);
    if (from) {
      const [fy, fm] = from.split('-').map(Number);
      startYm = Math.max(startYm, ym(fy, fm));
    }
    const endYm = Math.min(nowYm, birthYm + 18 * 12 - 1); // do miesiąca przed 18. urodzinami
    let sum = 0, months = 0;
    for (let x = startYm; x <= endYm; x++) {
      let amt = 0;
      for (const b of BENEFIT) if (x >= ym(b.from[0], b.from[1])) amt = b.amount;
      sum += amt; months += amt > 0 ? 1 : 0;
    }
    const ageMonths = nowYm - birthYm;
    const limit = Math.max(0, sum - (used || 0));
    return {
      sum, months, used: used || 0, limit, maxBonds: Math.floor(limit / 100),
      ageMonths, startYm, endYm,
      ageAt: (plusMonths) => (ageMonths + plusMonths) / 12,
    };
  }

  const api = { TYPES, ORDER, BELKA, bondModel, simulate, childLimit, round2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BondEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
