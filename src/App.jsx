import React, { useState, useMemo, useEffect, useRef, useLayoutEffect } from "react";

/**
 * Kaalgeplukt — nettoloon-calculator Nederland
 * "Plucked bare": shows what's left of your salary after the taxman is done.
 *
 * Toegespitst op: 13e maand (maandelijks), vakantiegeld (maandelijks),
 * pensioen vóór belasting, situatie ná de 30%-regeling.
 *
 * Alle jaargebonden cijfers (schijven, heffingskortingen, onbelaste vergoedingen)
 * staan per belastingjaar in TAX_YEARS hieronder. Nieuw jaar toevoegen: kopieer een
 * bestaand jaar en vul de officiële Belastingdienst/Belastingplan-cijfers in.
 */

const TAX_YEARS = {
  2026: {
    label: "2026",
    // Box 1: 35,75% t/m €38.883 · 37,56% t/m €78.426 · 49,50% daarboven
    brackets: [
      { upTo: 38883, rate: 0.3575 },
      { upTo: 78426, rate: 0.3756 },
      { upTo: Infinity, rate: 0.495 },
    ],
    // Algemene heffingskorting: max €3.115; afbouw vanaf €29.736 met 6,398%
    ahk: { max: 3115, startAfbouw: 29736, afbouwRate: 0.06398 },
    // Arbeidskorting: officiële 4-fasen-tabel, max €5.685
    ak: {
      phases: [
        { upTo: 11965, base: 0, rate: 0.08324 },
        { upTo: 25845, base: 996, rate: 0.31009 },
        { upTo: 45592, base: 5300, rate: 0.0195 },
        { upTo: 132920, base: 5685, rate: -0.0651 },
      ],
    },
    // Thuiswerkvergoeding, gerichte vrijstelling per dag.
    thuiswerkRate: 2.45,
  },
};

const TAX_YEAR_OPTIONS = Object.keys(TAX_YEARS)
  .map(Number)
  .sort((a, b) => b - a);

function boxTax(taxable, brackets) {
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    if (taxable <= prev) break;
    const amt = Math.min(taxable, b.upTo) - prev;
    tax += amt * b.rate;
    prev = b.upTo;
  }
  return tax;
}

// Same progressive walk as boxTax, but keeps the per-bracket amounts and tax
// instead of just the total — this is what the "Belastingschijven" section shows.
function bracketBreakdown(taxable, brackets) {
  let prev = 0;
  return brackets.map((b) => {
    const amount = Math.max(0, Math.min(taxable, b.upTo) - prev);
    const from = prev;
    prev = b.upTo;
    return { from, to: b.upTo, rate: b.rate, amount, tax: amount * b.rate };
  });
}

function algemeneHeffingskorting(verzamelinkomen, ahk) {
  if (verzamelinkomen <= ahk.startAfbouw) return ahk.max;
  return Math.max(0, ahk.max - ahk.afbouwRate * (verzamelinkomen - ahk.startAfbouw));
}

function arbeidskorting(arbeidsinkomen, ak) {
  let prevUpTo = 0;
  for (const p of ak.phases) {
    if (arbeidsinkomen <= p.upTo) return Math.max(0, p.base + p.rate * (arbeidsinkomen - prevUpTo));
    prevUpTo = p.upTo;
  }
  return 0;
}

const eur0 = (n) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(
    isFinite(n) ? n : 0
  );
const eur2 = (n) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(n) ? n : 0);
const pct = (n) =>
  new Intl.NumberFormat("nl-NL", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    isFinite(n) ? n : 0
  );
const pct2 = (n) =>
  new Intl.NumberFormat("nl-NL", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    isFinite(n) ? n : 0
  );

const WEEKS_PER_MONTH = 4.33; // gemiddeld aantal werkweken per maand

function compute(inp) {
  const {
    taxYear,
    base,
    include13,
    vakPct,
    vakInclude13,
    pensPct,
    pensBaseMode,
    franchise,
    ruling,
    thuiswerkRate,
    thuiswerkDays,
    overigeOnbelast,
  } = inp;

  const taxData = TAX_YEARS[taxYear] || TAX_YEARS[TAX_YEAR_OPTIONS[0]];

  const thirteenth = include13 ? base / 12 : 0;
  const vakBase = base + (vakInclude13 ? thirteenth : 0);
  const vakantiegeld = (vakPct / 100) * vakBase;
  const grossAnnual = base + thirteenth + vakantiegeld;

  const pensionGrondslagRaw = pensBaseMode === "total" ? grossAnnual : base;
  const pensionGrondslag = Math.max(0, pensionGrondslagRaw - franchise);
  const pension = (pensPct / 100) * pensionGrondslag;

  const taxFree = ruling ? grossAnnual * 0.3 : 0;
  const taxableWage = Math.max(0, grossAnnual - taxFree - pension);

  const taxBefore = boxTax(taxableWage, taxData.brackets);
  const ahk = algemeneHeffingskorting(taxableWage, taxData.ahk);
  const ak = arbeidskorting(taxableWage, taxData.ak);
  const credits = ahk + ak;
  const taxAfter = Math.max(0, taxBefore - credits);

  const netAnnual = grossAnnual - pension - taxAfter;

  // Onbelaste vergoedingen (gerichte vrijstellingen): netto, naast het loon.
  const thuiswerkMonthly = Math.max(0, thuiswerkDays) * Math.max(0, thuiswerkRate) * WEEKS_PER_MONTH;
  const overigeMonthly = Math.max(0, overigeOnbelast);
  const allowancesMonthly = thuiswerkMonthly + overigeMonthly;
  const allowancesAnnual = allowancesMonthly * 12;

  const netMonthly = netAnnual / 12;
  const takeHomeMonthly = netMonthly + allowancesMonthly;
  const takeHomeAnnual = netAnnual + allowancesAnnual;

  return {
    taxYear,
    taxData,
    base,
    thirteenth,
    vakantiegeld,
    grossAnnual,
    pension,
    taxFree,
    taxableWage,
    taxBefore,
    brackets: bracketBreakdown(taxableWage, taxData.brackets),
    credits,
    taxAfter,
    netAnnual,
    netMonthly,
    grossMonthly: grossAnnual / 12,
    effTaxRate: grossAnnual > 0 ? taxAfter / grossAnnual : 0,
    pluckedShare: grossAnnual > 0 ? (pension + taxAfter) / grossAnnual : 0,
    thuiswerkMonthly,
    overigeMonthly,
    allowancesMonthly,
    allowancesAnnual,
    takeHomeMonthly,
    takeHomeAnnual,
  };
}

const styles = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Archivo:wght@400;500;600;700&display=swap');

.kg-root{
  --bare:#ECEDE9; --card:#FAF9F6; --ink:#211C18; --ink-soft:#4a443c; --muted:#6E6A60; --faint:#9c978c;
  --pluck:#A8341F; --pluck-bg:#f0ddd6; --quill:#C9A063; --quill-bg:#f1e6d3;
  --kept:#3F5C3A; --kept-bg:#dfe7da; --line:#D4D2C9; --line-soft:#e4e2da;
  font-family:'Archivo',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  color:var(--ink); background:var(--bare);
  min-height:100%; box-sizing:border-box; padding:30px 20px 52px; -webkit-font-smoothing:antialiased;
}
.kg-root *{box-sizing:border-box;}
.kg-num{font-variant-numeric:tabular-nums lining-nums;}
.kg-wrap{max-width:1060px;margin:0 auto;}

/* header */
.kg-eyebrow{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--pluck);
  font-weight:600;margin:0 0 12px;}
.kg-wordmark{font-family:'Fraunces',serif;font-optical-sizing:auto;font-weight:600;
  font-size:clamp(46px,9vw,78px);line-height:.92;letter-spacing:-.015em;margin:0 0 4px;color:var(--ink);}
.kg-wordmark .dot{color:var(--pluck);}
.kg-brandrow{display:flex;align-items:center;gap:16px;}
.kg-brandrow .kg-wordmark{margin:0;}
.kg-logo{width:clamp(62px,10vw,88px);height:auto;flex:none;}
@media (max-width:560px){.kg-brandrow{gap:11px;}.kg-logo{width:54px;}}
.kg-lede{color:var(--muted);font-size:15px;line-height:1.55;max-width:62ch;margin:14px 0 28px;}
.kg-lede b{color:var(--ink-soft);font-weight:600;}

.kg-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:22px;align-items:start;}
@media (max-width:860px){.kg-grid{grid-template-columns:1fr;}}

.kg-card{background:var(--card);border:1px solid var(--line);border-radius:4px;padding:22px 22px 24px;
  box-shadow:0 1px 0 rgba(33,28,24,.03);}
.kg-card + .kg-card{margin-top:18px;}
.kg-sectlabel{font-family:'Fraunces',serif;font-weight:600;font-size:19px;letter-spacing:-.01em;
  margin:0 0 4px;color:var(--ink);display:flex;align-items:center;gap:9px;}
.kg-sectsub{font-size:11.5px;letter-spacing:.04em;color:var(--faint);margin:0 0 18px;text-transform:lowercase;}

.kg-field{margin-bottom:18px;}
.kg-field:last-child{margin-bottom:0;}
.kg-flabel{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;font-weight:600;
  margin-bottom:7px;color:var(--ink-soft);}
.kg-fhint{font-size:11px;color:var(--faint);font-weight:500;font-variant-numeric:tabular-nums lining-nums;}
.kg-inputrow{display:flex;align-items:center;border:1px solid var(--line);border-radius:3px;background:#fff;
  overflow:hidden;transition:border-color .15s,box-shadow .15s;}
.kg-inputrow:focus-within{border-color:var(--pluck);box-shadow:0 0 0 3px var(--pluck-bg);}
.kg-prefix{padding:0 11px;color:var(--faint);font-size:14px;border-right:1px solid var(--line-soft);
  align-self:stretch;display:flex;align-items:center;font-variant-numeric:tabular-nums lining-nums;}
.kg-input{flex:1;border:0;background:transparent;padding:11px 12px;font-size:15px;
  font-weight:600;font-variant-numeric:tabular-nums lining-nums;color:var(--ink);width:100%;outline:none;}
.kg-input::placeholder{color:var(--faint);font-weight:500;opacity:1;}
.kg-suffix{padding:0 12px;color:var(--faint);font-size:12.5px;}
.kg-fieldnote{font-size:11px;color:var(--faint);line-height:1.5;margin:9px 0 0;}

.kg-seg{display:flex;gap:6px;}
.kg-segbtn{flex:1;padding:9px 8px;border:1px solid var(--line);background:#fff;border-radius:3px;
  font-family:inherit;font-size:12.5px;color:var(--ink-soft);cursor:pointer;font-weight:600;
  transition:all .14s;text-align:center;}
.kg-segbtn:hover{border-color:var(--muted);}
.kg-segbtn[aria-pressed="true"]{background:var(--ink);color:var(--bare);border-color:var(--ink);}
.kg-segbtn:focus-visible{outline:2px solid var(--pluck);outline-offset:2px;}

.kg-toggle{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;
  border:1px solid var(--line);border-radius:3px;background:#fff;cursor:pointer;}
.kg-toggle:focus-visible{outline:2px solid var(--pluck);outline-offset:2px;}
.kg-toggle-txt{font-size:13px;font-weight:600;color:var(--ink-soft);}
.kg-toggle-sub{font-size:11px;color:var(--faint);margin-top:2px;font-weight:500;}
.kg-switch{width:42px;height:24px;border-radius:99px;background:var(--line);position:relative;flex:none;
  transition:background .16s;}
.kg-switch[data-on="true"]{background:var(--pluck);}
.kg-knob{position:absolute;top:2px;left:2px;width:20px;height:20px;border-radius:50%;background:#fff;
  box-shadow:0 1px 2px rgba(0,0,0,.25);transition:left .16s;}
.kg-switch[data-on="true"] .kg-knob{left:20px;}

/* hero result */
.kg-hero{background:var(--ink);color:var(--bare);border-radius:4px;padding:24px 24px 22px;
  position:relative;overflow:hidden;}
.kg-hero-eyebrow{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--quill);
  font-weight:600;margin:0 0 8px;position:relative;z-index:2;}
.kg-hero-num{font-family:'Fraunces',serif;font-optical-sizing:auto;font-weight:600;font-size:54px;
  line-height:.95;letter-spacing:-.02em;position:relative;z-index:2;}
.kg-hero-unit{font-family:'Archivo',sans-serif;font-size:16px;color:rgba(236,237,233,.55);font-weight:500;
  margin-left:8px;}
.kg-hero-stats{display:flex;gap:24px;margin-top:20px;padding-top:16px;
  border-top:1px solid rgba(236,237,233,.16);position:relative;z-index:2;flex-wrap:wrap;}
.kg-hstat-k{font-size:10.5px;color:rgba(236,237,233,.5);letter-spacing:.06em;text-transform:uppercase;font-weight:600;}
.kg-hstat-v{font-size:16px;font-weight:600;margin-top:3px;
  font-variant-numeric:tabular-nums lining-nums;}
.kg-hero-feather{position:absolute;right:-10px;top:-6px;width:150px;height:150px;opacity:.16;z-index:1;
  color:var(--quill);}
.kg-drift{position:absolute;width:30px;height:30px;color:var(--quill);opacity:.13;z-index:1;}
.kg-drift.d1{right:34px;top:96px;animation:kg-fall 9s ease-in-out infinite;}
.kg-drift.d2{right:120px;top:30px;animation:kg-fall 11s ease-in-out infinite 1.5s;}
@keyframes kg-fall{
  0%{transform:translateY(-6px) rotate(8deg);opacity:.05;}
  50%{transform:translateY(10px) rotate(-10deg);opacity:.16;}
  100%{transform:translateY(-6px) rotate(8deg);opacity:.05;}
}
@media (prefers-reduced-motion:reduce){.kg-drift{animation:none;}}

/* pluck bar — a duck flying along a progress bar, trailing feathers, the
   further right it gets the more of your gross the taxman has taken. */
.kg-pluckbar{margin-top:20px;position:relative;z-index:2;}
.kg-pluckbar-track{position:relative;height:14px;border-radius:99px;background:rgba(236,237,233,.14);overflow:visible;}
.kg-pluckbar-fill{height:100%;border-radius:99px;overflow:hidden;background:linear-gradient(90deg,#8a2a18,var(--pluck));
  transition:width .6s cubic-bezier(.4,0,.2,1);}
.kg-pluckbar-duck{position:absolute;top:50%;width:32px;height:22px;margin-left:-16px;margin-top:-11px;color:var(--quill);
  transition:left .6s cubic-bezier(.4,0,.2,1);animation:kg-bob 1.1s ease-in-out infinite;}
.kg-pluckbar-duckicon{width:100%;height:100%;overflow:visible;}
.kg-duckfly-wing{transform-origin:7px 11px;animation:kg-flap .45s ease-in-out infinite alternate;}
.kg-pluckbar-puff{position:absolute;width:9px;height:9px;color:var(--quill);opacity:0;
  left:5px;top:3px;animation:kg-puff 1.4s ease-out infinite;}
.kg-pluckbar-puff.p2{animation-delay:.7s;left:1px;top:7px;width:7px;height:7px;}
.kg-pluckbar-labels{display:flex;justify-content:space-between;margin-top:9px;font-size:11px;
  color:rgba(236,237,233,.55);position:relative;z-index:2;}
.kg-pluckbar-pct{font-weight:700;color:var(--quill);}
@keyframes kg-flap{from{transform:rotate(4deg);}to{transform:rotate(-22deg);}}
@keyframes kg-bob{0%,100%{transform:translateY(0);}50%{transform:translateY(-4px);}}
@keyframes kg-puff{
  0%{opacity:0;transform:translate(0,0) rotate(0deg) scale(.6);}
  20%{opacity:.9;}
  100%{opacity:0;transform:translate(-20px,-12px) rotate(-70deg) scale(.4);}
}
@media (prefers-reduced-motion:reduce){
  .kg-pluckbar-duck,.kg-duckfly-wing,.kg-pluckbar-puff{animation:none;}
}

/* pluck waterfall */
.kg-wf-row{display:flex;align-items:center;gap:13px;padding:11px 0;border-bottom:1px solid var(--line-soft);}
.kg-wf-row:last-child{border-bottom:0;}
.kg-wf-feather{width:22px;flex:none;display:flex;justify-content:center;}
.kg-wf-feather svg{width:18px;height:18px;}
.kg-wf-main{flex:1;min-width:0;}
.kg-wf-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:10px;}
.kg-wf-label{font-size:13.5px;font-weight:600;color:var(--ink-soft);}
.kg-wf-amt{font-size:14px;font-weight:600;font-variant-numeric:tabular-nums lining-nums;flex:none;}
.kg-wf-bar{height:7px;border-radius:99px;background:var(--line-soft);overflow:hidden;}
.kg-wf-fill{height:100%;border-radius:99px;transition:width .4s cubic-bezier(.4,0,.2,1);}
.kg-wf-row.is-total .kg-wf-label{color:var(--ink);font-weight:700;}
.kg-wf-row.is-net{background:var(--kept-bg);margin:8px -14px 0;padding:14px;border-radius:4px;border:0;}
.kg-wf-row.is-net .kg-wf-label{color:var(--kept);font-weight:700;font-size:14px;}
.kg-wf-row.is-net .kg-wf-amt{color:var(--kept);font-weight:700;font-size:16px;}
.kg-amt-pluck{color:var(--pluck);}
.kg-amt-kept{color:var(--kept);}

/* tax brackets */
.kg-brackets{display:flex;flex-direction:column;gap:16px;}
.kg-bracket-row{opacity:1;transition:opacity .2s;}
.kg-bracket-row.is-empty{opacity:.4;}
.kg-bracket-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px;gap:10px;}
.kg-bracket-label{font-size:13.5px;font-weight:600;color:var(--ink-soft);}
.kg-bracket-range{font-size:11.5px;color:var(--faint);font-weight:500;margin-left:6px;}
.kg-bracket-rate{font-size:13px;font-weight:700;color:var(--ink);font-variant-numeric:tabular-nums lining-nums;flex:none;}
.kg-bracket-bar{height:7px;border-radius:99px;background:var(--line-soft);overflow:hidden;}
.kg-bracket-fill{height:100%;border-radius:99px;background:var(--pluck);transition:width .4s cubic-bezier(.4,0,.2,1);}
.kg-bracket-bottom{display:flex;justify-content:space-between;align-items:baseline;margin-top:6px;gap:10px;
  font-size:12px;color:var(--muted);}
.kg-bracket-tax{font-weight:600;color:var(--pluck);font-variant-numeric:tabular-nums lining-nums;flex:none;}

/* monthly table */
.kg-mtable{width:100%;border-collapse:collapse;}
.kg-mtable td{padding:9px 0;font-size:13.5px;border-bottom:1px solid var(--line-soft);}
.kg-mtable tr:last-child td{border-bottom:0;}
.kg-mtable td.k{color:var(--ink-soft);font-weight:500;}
.kg-mtable td.v{text-align:right;font-variant-numeric:tabular-nums lining-nums;font-weight:600;}
.kg-mtable tr.sub td.k{color:var(--muted);padding-left:14px;font-size:12.5px;font-weight:400;}
.kg-mtable tr.sub td.v{color:var(--muted);font-weight:400;}
.kg-mtable tr.subtotal td{font-weight:600;color:var(--ink-soft);border-top:1px solid var(--line-soft);padding-top:11px;}
.kg-mtable tr.grand td{font-weight:700;color:var(--ink);border-top:1.5px solid var(--line);padding-top:12px;font-size:14.5px;}
.kg-mtable tr.grand td.v{color:var(--kept);font-family:'Fraunces',serif;font-size:17px;}

.kg-note{font-size:11.5px;color:var(--faint);line-height:1.6;margin-top:18px;padding-top:16px;
  border-top:1px solid var(--line-soft);}
.kg-note b{color:var(--muted);font-weight:600;}
.kg-disclaimer{margin-top:18px;padding:13px 15px;background:var(--pluck-bg);border-left:3px solid var(--pluck);
  border-radius:3px;font-size:12px;line-height:1.55;color:var(--ink-soft);}
.kg-disclaimer strong{color:var(--pluck);font-weight:700;}
.kg-detail{margin-top:14px;}
.kg-detail summary{font-size:12px;color:var(--pluck);cursor:pointer;font-weight:600;list-style:none;user-select:none;}
.kg-detail summary::-webkit-details-marker{display:none;}
.kg-detail summary::before{content:"+ ";font-variant-numeric:tabular-nums lining-nums;}
.kg-detail[open] summary::before{content:"– ";}

.kg-footer{margin:30px auto 0;max-width:1060px;font-size:11.5px;color:var(--faint);line-height:1.6;
  display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;}
.kg-footer-note{display:flex;align-items:center;gap:8px;}
.kg-footer-note svg{width:14px;height:14px;color:var(--quill);flex:none;}
.kg-footer-link{display:flex;align-items:center;gap:6px;color:var(--faint);text-decoration:none;font-weight:500;}
.kg-footer-link:hover{color:var(--ink-soft);}
.kg-footer-link svg{width:14px;height:14px;flex:none;}
`;

// One tidy feather. variant tints + tilts it: kept = upright green, plucked = tilted oxblood, etc.
function Feather({ variant = "ink" }) {
  const color =
    variant === "pluck" ? "var(--pluck)" : variant === "kept" ? "var(--kept)" : variant === "quill" ? "var(--quill)" : "var(--ink-soft)";
  const opacity = variant === "pluck" ? 0.85 : 1;
  const rotate = variant === "pluck" ? 28 : variant === "quill" ? -12 : 0;
  return (
    <svg viewBox="0 0 24 24" fill="none" style={{ color, opacity, transform: `rotate(${rotate}deg)` }} aria-hidden="true">
      <path
        d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z"
        fill="currentColor"
        fillOpacity="0.16"
      />
      <path
        d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M17 6 L6.4 17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M14.5 6.7c-1 .3-2 .9-2.8 1.7M16.2 9c-1 .3-2 .9-2.8 1.7M13 10c-1 .3-2 .9-2.8 1.7"
        stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

// Half-plucked duck — the mascot. Deadpan, a bare patch, one feather drifting off.
function DuckMark({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 72 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Kaalgeplukt — een half geplukte eend"
    >
      <path
        d="M24 10 C31 10 35 13 36 18 C46 18 53 21 55 26 C56 22 59 20 61 22 C61 25 58 28 55 28 C56 36 53 44 41 48 C30 51 20 49 16 41 C13 35 13 26 17 22 C14 20 14 13 24 10 Z"
        fill="var(--ink)"
        fillOpacity="0.10"
        stroke="var(--ink)"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M17 23 C10 23 3 24.3 3 26.2 C3 28 10 28.6 17 28 Z" fill="var(--pluck)" stroke="var(--pluck)" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="23" cy="20.5" r="1.8" fill="var(--ink)" />
      <path
        d="M31 30 C39 28.5 46 30.5 48 34.5 C43 33.5 37 33.5 32 34 C31 32.5 31 31 31 30 Z"
        fill="var(--ink)"
        fillOpacity="0.13"
        stroke="var(--ink)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* bare, plucked patch */}
      <path d="M24 42 l0 3 M28 43 l0 3 M32 43 l0 2.5" stroke="var(--ink)" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
      {/* one feather drifting off */}
      <path
        d="M64 7 C60 8 57 11 56.2 15 l1.7-1.3 c1 .2 1.9 .1 2.7-.3 C64 12 65 9.4 64 7 Z"
        fill="var(--quill)"
        fillOpacity="0.22"
        stroke="var(--quill)"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M61.6 9 L57.4 13.6" stroke="var(--quill)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

// A little side-on duck for the pluck bar: an egg-shaped body (the classic
// rubber-duck simplification), a flapping wing, a tail flick, a beak. Colored
// via currentColor so it works light-on-dark inside the hero card.
function DuckFly({ className }) {
  return (
    <svg className={className} viewBox="0 0 34 22" fill="none" aria-hidden="true">
      <path d="M3 12 Q0 10 1 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <ellipse cx="14" cy="12" rx="11" ry="7.5" transform="rotate(-8 14 12)" fill="currentColor" fillOpacity="0.22" stroke="currentColor" strokeWidth="1.3" />
      <path className="kg-duckfly-wing" d="M7 11 Q13 4 20 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M23 7 L29 8.3 L23.5 10.2 Z" fill="currentColor" />
      <circle cx="21" cy="6.3" r="1.1" fill="var(--ink)" />
    </svg>
  );
}

// Only digits and a single comma are meaningful input — no letters, no minus,
// no second separator, and at most 2 digits after the comma (cents-precision is
// as fine-grained as anything on this site gets). The dot is reserved for
// auto-inserted thousands grouping below, so any dot typed or pasted is dropped.
function sanitizeNumericText(raw) {
  const out = raw.replace(/\./g, "").replace(/[^0-9,]/g, "");
  const firstComma = out.indexOf(",");
  if (firstComma === -1) return out;
  const intPart = out.slice(0, firstComma);
  const decPart = out.slice(firstComma + 1).replace(/,/g, "").slice(0, 2);
  return `${intPart},${decPart}`;
}

// Dutch numbering: "." every three digits in the integer part, "," before the
// decimals. Input is a sanitizeNumericText() result (digits + one comma, no dots).
function formatGrouped(clean) {
  const commaIdx = clean.indexOf(",");
  const intPart = commaIdx === -1 ? clean : clean.slice(0, commaIdx);
  const rest = commaIdx === -1 ? "" : clean.slice(commaIdx);
  let grouped = "";
  for (let i = 0; i < intPart.length; i++) {
    grouped += intPart[i];
    const posFromRight = intPart.length - i;
    if (posFromRight > 1 && posFromRight % 3 === 1) grouped += ".";
  }
  return grouped + rest;
}

// A resting value of exactly 0 renders as an empty field with a "0" placeholder
// instead of a literal "0" — every field defaults to 0, so a hard zero in every
// box would look like real, deliberate input rather than "nothing filled in yet".
const toGroupedText = (n) => (Number.isNaN(n) || n === 0 ? "" : formatGrouped(String(n).replace(".", ",")));

function NumberInput({ value, onChange, prefix, suffix, step = 1, min = 0 }) {
  const [text, setText] = useState(() => toGroupedText(value));
  const inputRef = useRef(null);
  const pendingCaret = useRef(null);

  // Resync from outside (e.g. the maand/jaar toggle recomputing this value) without
  // clobbering what the user is mid-typing (e.g. "5" while a stale "0" is still parsed as 0).
  useEffect(() => {
    const parsed = parseFloat(sanitizeNumericText(text).replace(",", "."));
    const current = Number.isNaN(parsed) ? 0 : parsed;
    if (current !== value) {
      setText(toGroupedText(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Typing reformats the whole string (grouping dots shift as digits are added),
  // so the caret has to be repositioned by hand or it jumps to the end on every key.
  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [text]);

  return (
    <div className="kg-inputrow">
      {prefix && <span className="kg-prefix">{prefix}</span>}
      <input
        ref={inputRef}
        className="kg-input"
        type="text"
        inputMode="decimal"
        value={text}
        placeholder="0"
        onChange={(e) => {
          const el = e.target;
          const caret = el.selectionStart ?? el.value.length;
          const significantBeforeCaret = sanitizeNumericText(el.value.slice(0, caret)).length;

          const clean = sanitizeNumericText(el.value);
          const grouped = formatGrouped(clean);

          let count = 0;
          let pos = 0;
          while (pos < grouped.length && count < significantBeforeCaret) {
            if (grouped[pos] !== ".") count++;
            pos++;
          }
          pendingCaret.current = pos;

          setText(grouped);
          const v = parseFloat(clean.replace(",", "."));
          onChange(Number.isNaN(v) ? 0 : Math.max(min, v));
        }}
      />
      {suffix && <span className="kg-suffix">{suffix}</span>}
    </div>
  );
}

function Toggle({ on, onClick, label, sub }) {
  return (
    <div
      className="kg-toggle"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick())}
    >
      <div>
        <div className="kg-toggle-txt">{label}</div>
        {sub && <div className="kg-toggle-sub">{sub}</div>}
      </div>
      <div className="kg-switch" data-on={on}>
        <div className="kg-knob" />
      </div>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="kg-seg">
      {options.map((o) => (
        <button key={o.value} className="kg-segbtn" aria-pressed={value === o.value} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WaterfallRow({ label, amount, max, feather, fill, variant, amtClass }) {
  const width = max > 0 ? Math.min(100, (Math.abs(amount) / max) * 100) : 0;
  const cls = `kg-wf-row${variant === "total" ? " is-total" : ""}${variant === "net" ? " is-net" : ""}`;
  return (
    <div className={cls}>
      <div className="kg-wf-feather">
        <Feather variant={feather} />
      </div>
      <div className="kg-wf-main">
        <div className="kg-wf-top">
          <span className="kg-wf-label">{label}</span>
          <span className={`kg-wf-amt ${amtClass || ""}`}>{eur0(amount)}</span>
        </div>
        {variant !== "net" && (
          <div className="kg-wf-bar">
            <div className="kg-wf-fill" style={{ width: `${width}%`, background: fill }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [taxYear, setTaxYear] = useState(TAX_YEAR_OPTIONS[0]);
  const [baseInput, setBaseInput] = useState(0);
  const [incomePeriod, setIncomePeriod] = useState("year");
  const base = incomePeriod === "month" ? baseInput * 12 : baseInput;

  const switchPeriod = (p) => {
    if (p === incomePeriod) return;
    setBaseInput((v) => (p === "month" ? Math.round((v / 12) * 100) / 100 : Math.round(v * 12)));
    setIncomePeriod(p);
  };

  const [include13, setInclude13] = useState(true);
  const [vakPct, setVakPct] = useState(0);
  const [vakInclude13, setVakInclude13] = useState(false);
  const [pensPct, setPensPct] = useState(0);
  const [pensBaseMode, setPensBaseMode] = useState("base");
  const [franchise, setFranchise] = useState(0);
  const [ruling, setRuling] = useState(false);

  const [thuiswerkRate, setThuiswerkRate] = useState(0);
  const [thuiswerkDays, setThuiswerkDays] = useState(0);
  const [overigeOnbelast, setOverigeOnbelast] = useState(0);

  const r = useMemo(
    () =>
      compute({
        taxYear,
        base,
        include13,
        vakPct,
        vakInclude13,
        pensPct,
        pensBaseMode,
        franchise,
        ruling,
        thuiswerkRate,
        thuiswerkDays,
        overigeOnbelast,
      }),
    [
      taxYear,
      base,
      include13,
      vakPct,
      vakInclude13,
      pensPct,
      pensBaseMode,
      franchise,
      ruling,
      thuiswerkRate,
      thuiswerkDays,
      overigeOnbelast,
    ]
  );

  const max = r.grossAnnual;
  const pluckedPct = Math.min(100, Math.max(0, r.pluckedShare * 100));

  return (
    <div className="kg-root">
      <style>{styles}</style>
      <div className="kg-wrap">
        <p className="kg-eyebrow">Nettoloon · Nederland {taxYear} · ná de 30%-regeling</p>
        <div className="kg-brandrow">
          <DuckMark className="kg-logo" />
          <h1 className="kg-wordmark">
            Kaalgeplukt<span className="dot">.</span>
          </h1>
        </div>
        <p className="kg-lede">
          De Belastingdienst plukt — deze rekenmachine laat zien hoeveel veren je overhoudt. Mét je{" "}
          <b>maandelijkse 13e maand en vakantiegeld</b>, en met <b>pensioen eraf vóór de belasting</b>: precies de
          plukbeurten die andere tools overslaan.
        </p>

        <div className="kg-grid">
          {/* INPUTS */}
          <div>
            <div className="kg-card">
              <h2 className="kg-sectlabel">Wat je verdient</h2>
              <p className="kg-sectsub">het verenpak voordat er geplukt wordt</p>

              <div className="kg-field">
                <div className="kg-flabel">
                  <span>Belastingjaar</span>
                </div>
                <Segmented
                  value={taxYear}
                  onChange={setTaxYear}
                  options={TAX_YEAR_OPTIONS.map((y) => ({ value: y, label: TAX_YEARS[y].label }))}
                />
              </div>

              <div className="kg-field">
                <Toggle
                  on={ruling}
                  onClick={() => setRuling((v) => !v)}
                  label="Vergelijk mét 30%-regeling"
                  sub="Indicatief: 30% van bruto onbelast"
                />
              </div>

              <div className="kg-field">
                <div className="kg-flabel">
                  <span>Bruto {incomePeriod === "month" ? "maandsalaris" : "jaarsalaris"} (basis)</span>
                  <span className="kg-fhint">
                    = {eur0(incomePeriod === "month" ? base : base / 12)} / {incomePeriod === "month" ? "jaar" : "maand"}
                  </span>
                </div>
                <NumberInput value={baseInput} onChange={setBaseInput} prefix="€" step={incomePeriod === "month" ? 50 : 500} />
                <div style={{ marginTop: 8 }}>
                  <Segmented
                    value={incomePeriod}
                    onChange={switchPeriod}
                    options={[
                      { value: "year", label: "Per jaar" },
                      { value: "month", label: "Per maand" },
                    ]}
                  />
                </div>
              </div>

              <div className="kg-field">
                <Toggle
                  on={include13}
                  onClick={() => setInclude13((v) => !v)}
                  label="13e maand (maandelijks uitgekeerd)"
                  sub={include13 ? `+ ${eur0(base / 12)} per jaar, gespreid over 12 maanden` : "Uit"}
                />
              </div>

              <div className="kg-field">
                <div className="kg-flabel">
                  <span>Vakantiegeld</span>
                  <span className="kg-fhint">{eur0(r.vakantiegeld / 12)} / maand</span>
                </div>
                <NumberInput value={vakPct} onChange={setVakPct} suffix="% van grondslag" step={0.5} />
                <div style={{ marginTop: 8 }}>
                  <Segmented
                    value={vakInclude13 ? "incl" : "base"}
                    onChange={(v) => setVakInclude13(v === "incl")}
                    options={[
                      { value: "base", label: "Over basissalaris" },
                      { value: "incl", label: "Incl. 13e maand" },
                    ]}
                  />
                </div>
              </div>
            </div>

            <div className="kg-card">
              <h2 className="kg-sectlabel">Wat eraf gaat</h2>
              <p className="kg-sectsub">veer voor veer, vóór de belasting</p>

              <div className="kg-field">
                <div className="kg-flabel">
                  <span>Pensioenpremie (werknemersdeel)</span>
                  <span className="kg-fhint">vóór belasting</span>
                </div>
                <NumberInput value={pensPct} onChange={setPensPct} suffix="% van grondslag" step={0.1} />
                <div style={{ marginTop: 8 }}>
                  <Segmented
                    value={pensBaseMode}
                    onChange={setPensBaseMode}
                    options={[
                      { value: "base", label: "Over basissalaris" },
                      { value: "total", label: "Over totaal bruto" },
                    ]}
                  />
                </div>
                <details className="kg-detail">
                  <summary>Pensioenfranchise (geavanceerd)</summary>
                  <div style={{ marginTop: 10 }}>
                    <div className="kg-flabel">
                      <span>Franchise (premievrije voet)</span>
                      <span className="kg-fhint">aftrek vóór premie</span>
                    </div>
                    <NumberInput value={franchise} onChange={setFranchise} prefix="€" step={500} />
                  </div>
                </details>
              </div>
            </div>

            <div className="kg-card">
              <h2 className="kg-sectlabel">Onbelast erbij</h2>
              <p className="kg-sectsub">vergoedingen die de pluk ontlopen — netto, naast je loon</p>

              <div className="kg-field">
                <div className="kg-flabel">
                  <span>Thuiswerkvergoeding</span>
                  <span className="kg-fhint">{eur2(r.thuiswerkMonthly)} / maand</span>
                </div>
                <NumberInput value={thuiswerkRate} onChange={setThuiswerkRate} prefix="€" suffix="per thuiswerkdag" step={0.05} />
                <div style={{ marginTop: 8 }}>
                  <div className="kg-flabel">
                    <span>Thuiswerkdagen</span>
                    <span className="kg-fhint">× {WEEKS_PER_MONTH} weken/maand</span>
                  </div>
                  <NumberInput value={thuiswerkDays} onChange={setThuiswerkDays} suffix="dagen per week" step={1} />
                </div>
                <p className="kg-fieldnote">
                  Onbelast tot {eur2(r.taxData.thuiswerkRate)} per dag ({taxYear}). Geldt niet op dagen dat je
                  reiskosten naar kantoor vergoed krijgt.
                </p>
              </div>

              <div className="kg-field">
                <div className="kg-flabel">
                  <span>Overige onbelaste vergoeding</span>
                  <span className="kg-fhint">bijv. reiskosten, internet</span>
                </div>
                <NumberInput value={overigeOnbelast} onChange={setOverigeOnbelast} prefix="€" suffix="per maand" step={10} />
              </div>
            </div>
          </div>

          {/* RESULT */}
          <div>
            <div className="kg-hero">
              <svg className="kg-hero-feather" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                <path d="M17 6 L6.4 17" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              <svg className="kg-drift d1" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
              <svg className="kg-drift d2" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>

              <p className="kg-hero-eyebrow">Na de pluk hou je over · per maand{ruling ? " · mét 30%" : ""}</p>
              <div>
                <span className="kg-hero-num">{eur0(r.takeHomeMonthly)}</span>
                <span className="kg-hero-unit">/ maand</span>
              </div>
              <div className="kg-hero-stats">
                <div>
                  <div className="kg-hstat-k">Netto loon / mnd</div>
                  <div className="kg-hstat-v">{eur0(r.netMonthly)}</div>
                </div>
                <div>
                  <div className="kg-hstat-k">Onbelast erbij</div>
                  <div className="kg-hstat-v">{eur0(r.allowancesMonthly)}</div>
                </div>
                <div>
                  <div className="kg-hstat-k">Kaalgeplukt</div>
                  <div className="kg-hstat-v">{pct(r.pluckedShare)}</div>
                </div>
              </div>

              <div className="kg-pluckbar">
                <div className="kg-pluckbar-track">
                  <div className="kg-pluckbar-fill" style={{ width: `${pluckedPct}%` }} />
                  <div className="kg-pluckbar-duck" style={{ left: `${pluckedPct}%` }}>
                    <DuckFly className="kg-pluckbar-duckicon" />
                    <svg className="kg-pluckbar-puff p1" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <path d="M17 6 L6.4 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                    <svg className="kg-pluckbar-puff p2" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                      <path d="M17 6 L6.4 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </div>
                </div>
                <div className="kg-pluckbar-labels">
                  <span>Overgehouden</span>
                  <span className="kg-pluckbar-pct">{pct(r.pluckedShare)} kaalgeplukt</span>
                </div>
              </div>
            </div>

            <div className="kg-card">
              <h2 className="kg-sectlabel">De pluk</h2>
              <p className="kg-sectsub">van bruto naar netto, per jaar</p>
              <WaterfallRow label="Bruto jaarloon" amount={r.grossAnnual} max={max} feather="quill" fill="var(--quill)" variant="total" />
              <WaterfallRow label="Pensioenpremie" amount={r.pension} max={max} feather="pluck" fill="var(--pluck)" amtClass="kg-amt-pluck" />
              {ruling && (
                <WaterfallRow label="Onbelast (30%-regeling)" amount={r.taxFree} max={max} feather="quill" fill="#cdb27a" amtClass="" />
              )}
              <WaterfallRow label="Belastbaar loon" amount={r.taxableWage} max={max} feather="ink" fill="var(--ink-soft)" variant="total" />
              <WaterfallRow label="Loonheffing (vóór korting)" amount={r.taxBefore} max={max} feather="pluck" fill="var(--pluck)" amtClass="kg-amt-pluck" />
              <WaterfallRow label="Heffingskortingen (terug)" amount={r.credits} max={max} feather="kept" fill="var(--kept)" amtClass="kg-amt-kept" />
              <WaterfallRow label="Netto per jaar" amount={r.netAnnual} max={max} feather="kept" variant="net" />
            </div>

            <div className="kg-card">
              <h2 className="kg-sectlabel">Belastingschijven</h2>
              <p className="kg-sectsub">hoe je belastbaar loon over de schijven van box 1 valt</p>
              <div className="kg-brackets">
                {r.brackets.map((b, i) => {
                  const bracketWidth = b.to === Infinity ? Math.max(b.amount, 1) : b.to - b.from;
                  const fillPct = bracketWidth > 0 ? Math.min(100, (b.amount / bracketWidth) * 100) : 0;
                  return (
                    <div className={`kg-bracket-row${b.amount <= 0 ? " is-empty" : ""}`} key={i}>
                      <div className="kg-bracket-top">
                        <span className="kg-bracket-label">
                          Schijf {i + 1}
                          <span className="kg-bracket-range">{b.to === Infinity ? "daarboven" : `tot ${eur0(b.to)}`}</span>
                        </span>
                        <span className="kg-bracket-rate">{pct2(b.rate)}</span>
                      </div>
                      <div className="kg-bracket-bar">
                        <div className="kg-bracket-fill" style={{ width: `${fillPct}%` }} />
                      </div>
                      <div className="kg-bracket-bottom">
                        <span>{b.amount > 0 ? `${eur0(b.amount)} belast in deze schijf` : "niet bereikt op dit inkomen"}</span>
                        {b.amount > 0 && <span className="kg-bracket-tax">{eur0(b.tax)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="kg-note">
                <b>Let op:</b> dit is de loonheffing vóór de heffingskortingen ({eur0(r.credits)} terug) — samen
                goed voor {eur0(r.taxBefore)}, gelijk aan de <b>Loonheffing (vóór korting)</b> hierboven. Ná korting
                betaal je {eur0(r.taxAfter)} per jaar.
              </p>
            </div>

            <div className="kg-card">
              <h2 className="kg-sectlabel">Per maand, uitgesplitst</h2>
              <p className="kg-sectsub">wat er maandelijks binnenkomt en weggaat</p>
              <table className="kg-mtable">
                <tbody>
                  <tr>
                    <td className="k">Basissalaris</td>
                    <td className="v">{eur2(r.base / 12)}</td>
                  </tr>
                  {include13 && (
                    <tr className="sub">
                      <td className="k">13e maand (gespreid)</td>
                      <td className="v">{eur2(r.thirteenth / 12)}</td>
                    </tr>
                  )}
                  <tr className="sub">
                    <td className="k">Vakantiegeld (gespreid)</td>
                    <td className="v">{eur2(r.vakantiegeld / 12)}</td>
                  </tr>
                  <tr>
                    <td className="k">Bruto per maand</td>
                    <td className="v">{eur2(r.grossMonthly)}</td>
                  </tr>
                  <tr>
                    <td className="k" style={{ color: "var(--pluck)" }}>− Pensioenpremie</td>
                    <td className="v" style={{ color: "var(--pluck)" }}>{eur2(r.pension / 12)}</td>
                  </tr>
                  <tr>
                    <td className="k" style={{ color: "var(--pluck)" }}>− Loonheffing (na korting)</td>
                    <td className="v" style={{ color: "var(--pluck)" }}>{eur2(r.taxAfter / 12)}</td>
                  </tr>
                  {r.allowancesMonthly > 0 ? (
                    <>
                      <tr className="subtotal">
                        <td className="k">Netto loon per maand</td>
                        <td className="v">{eur2(r.netMonthly)}</td>
                      </tr>
                      {r.thuiswerkMonthly > 0 && (
                        <tr className="sub">
                          <td className="k" style={{ color: "var(--kept)" }}>+ Thuiswerkvergoeding (onbelast)</td>
                          <td className="v" style={{ color: "var(--kept)" }}>{eur2(r.thuiswerkMonthly)}</td>
                        </tr>
                      )}
                      {r.overigeMonthly > 0 && (
                        <tr className="sub">
                          <td className="k" style={{ color: "var(--kept)" }}>+ Overige onbelaste vergoeding</td>
                          <td className="v" style={{ color: "var(--kept)" }}>{eur2(r.overigeMonthly)}</td>
                        </tr>
                      )}
                      <tr className="grand">
                        <td className="k">Totaal per maand in handen</td>
                        <td className="v">{eur2(r.takeHomeMonthly)}</td>
                      </tr>
                    </>
                  ) : (
                    <tr className="grand">
                      <td className="k">Netto per maand</td>
                      <td className="v">{eur2(r.netMonthly)}</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <div className="kg-disclaimer">
                <strong>Alleen ter informatie — geen belastingadvies.</strong> Deze rekenmachine geeft een
                schatting om zelf mee te rekenen en te plannen. Het is geen fiscaal, juridisch of financieel
                advies. Controleer altijd je eigen loonstrook en raadpleeg de Belastingdienst of een adviseur
                voordat je beslissingen neemt.
              </div>

              <div className="kg-note">
                <b>Aannames.</b> Onder AOW-leeftijd, geen fiscale partner, alleen inkomen uit dienstbetrekking.
                Pensioenpremie verlaagt het belastbaar loon; heffingskortingen zijn op jaarbasis berekend en door
                12 gedeeld. Onbelaste vergoedingen (thuiswerk, reiskosten) worden netto bovenop het loon geteld en
                lopen niet door de belasting — aangenomen dat je binnen de vrijgestelde maxima blijft. De
                Zvw-bijdrage betaalt je werkgever en staat niet op je strook. Een echte loonstrook kan een paar euro
                afwijken door afronding{ruling ? "; de 30%-regeling is hier vereenvoudigd weergegeven" : ""}.
              </div>
            </div>
          </div>
        </div>

        <div className="kg-footer">
          <div className="kg-footer-note">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M19.5 3.6c-5.6-.5-11.4 2.9-13.8 9-.8 2-1.1 4-1.2 6.1l2.6-2.6c1 .3 2 .4 3 .4 5.7 0 9.9-4.6 10.1-10.3.02-.9-.02-1.8-.13-2.6z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              <path d="M17 6 L6.4 17" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Tarieven en heffingskortingen Nederland · belastingjaar {taxYear}.
          </div>
          <a className="kg-footer-link" href="https://github.com/bothmanity/kaalgeplukt-site" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2C6.48 2 2 6.58 2 12.19c0 4.49 2.87 8.3 6.84 9.65.5.09.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.78.61-3.37-1.21-3.37-1.21-.46-1.18-1.11-1.5-1.11-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.55 2.34 1.1 2.91.84.09-.66.35-1.1.63-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.32 9.32 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.79-4.57 5.05.36.32.68.95.68 1.92 0 1.39-.01 2.51-.01 2.85 0 .27.18.59.69.49A10.02 10.02 0 0 0 22 12.19C22 6.58 17.52 2 12 2z" />
            </svg>
            GitHub
          </a>
        </div>
      </div>
    </div>
  );
}
