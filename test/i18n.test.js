// RNG Chess i18n tests (v1.2.1) — runs the real UI script from index.html
// in a fake DOM and checks: every key exists in all 7 languages, switching
// changes visible text, the choice persists in localStorage ('lang'), the
// browser language is mapped on first load, "Xabinski" is never translated,
// the advanced-settings + Xabinski reveal strings translate, and no v1.3
// text remains. The engine underneath is the new remote one (Rayleigh king
// counts, custom distributions, opening filter) — its own suite lives in
// test/engine.test.js. Run: node test/i18n.test.js
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const uiSrc = blocks.find(s => s.includes('attachConn'));
const engineSrc = blocks.find(s => s.includes('module.exports'));
if (!uiSrc || !engineSrc) { console.error('FAIL: script blocks not found'); process.exit(1); }

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}

// ---------- static checks on the file itself ----------
console.log('Version + no-v1.3 guards:');
check('footer/header say v1.2.1', html.includes('v1.2.1'));
check('no v1.3 anywhere in the file', !html.includes('v1.3'));
check('no pass rule (ensureTurnCanMove) anywhere', !html.includes('ensureTurnCanMove'));
check('no passNote anywhere', !html.includes('passNote'));
check("Henrique's new engine is intact (Rayleigh / opening filter / distributions)",
  ['sampleRayleigh', 'KING_ZERO_CUTOFF', 'acceptsOpening', 'finalPieceWeights',
   'referencePieceWeights', 'calibrateReferenceShare', 'countWeights', 'setupAxis',
   'revealXabinski', 'Xabinski!.jpeg', 'OPENING_ATTEMPTS'].every(s => html.includes(s)));
check("the Xabinski quote translates with the language (only the name stays)",
  html.includes('<p class="xabinski-quote" data-i18n="xabQuote">') && !html.includes('<p class="xabinski-quote" lang="pt-BR">'));
check('language switcher present with all 7 options',
  ['value="en"', 'value="pt"', 'value="es"', 'value="zh"', 'value="ja"', 'value="fr"', 'value="ko"'].every(s => html.includes(s))
  && html.includes('id="langSelect"'));
check('switcher sits in the header (before the menu screen)', html.indexOf('langSelect') < html.indexOf('id="menuScreen"'));

// ---------- fake DOM ----------
function makeEl() {
  return {
    style: {}, dataset: {}, children: [], _l: {}, _attrs: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    innerHTML: '', textContent: '', value: '', className: '', placeholder: '',
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { this._l[ev] = fn; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k]; },
    click() { if (this.onclick) this.onclick(); else if (this._l.click) this._l.click(); },
  };
}
function makeCtx({ storedLang, navLang, seedEls }) {
  const els = {};
  const store = {};
  if (storedLang) store.lang = storedLang;
  const sandbox = {
    console,
    location: { search: '', origin: 'https://rng-chess.pages.dev', pathname: '/', href: 'https://rng-chess.pages.dev/' },
    navigator: { language: navLang || 'en-US' },
    window: {},
    document: {
      title: '',
      documentElement: { lang: '' },
      getElementById(id) { return (els[id] = els[id] || makeEl()); },
      createElement() { return makeEl(); },
      addEventListener() {},
      querySelectorAll(sel) {
        const all = Object.values(els);
        if (sel === '[data-i18n]') return all.filter(e => e.dataset && e.dataset.i18n);
        if (sel === '[data-i18n-html]') return all.filter(e => e.dataset && e.dataset.i18nHtml);
        if (sel === '[data-i18n-ph]') return all.filter(e => e.dataset && e.dataset.i18nPh);
        if (sel === '[data-i18n-aria]') return all.filter(e => e.dataset && e.dataset.i18nAria);
        return [];
      },
    },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, crypto,
    module: { exports: {} },
  };
  if (seedEls) seedEls(els, makeEl);
  vm.createContext(sandbox);
  vm.runInContext(engineSrc, sandbox);
  vm.runInContext(uiSrc, sandbox);
  return { sandbox, els, store };
}
function probe(ctx, expr) { return vm.runInContext(expr, ctx.sandbox); }

// ---------- dictionary parity ----------
console.log('Dictionary parity (via the real UI script):');
{
  const ctx = makeCtx({});
  const langs = probe(ctx, 'Object.keys(I18N)');
  check('7 languages present (en pt es zh ja fr ko)',
    JSON.stringify([...langs].sort()) === JSON.stringify(['en', 'es', 'fr', 'ja', 'ko', 'pt', 'zh']));
  const enKeys = probe(ctx, 'Object.keys(I18N.en)');
  check('140 keys in English (104 base + 36 advanced/Xabinski)', enKeys.length === 140, 'got ' + enKeys.length);
  let missing = [];
  for (const l of langs) {
    const n = probe(ctx, 'Object.keys(I18N.' + l + ').length');
    if (n !== enKeys.length) missing.push(l + ': ' + n + ' keys');
    for (const k of enKeys) {
      if (!probe(ctx, 'I18N.' + l + '.hasOwnProperty("' + k + '")')) missing.push(l + ':' + k);
    }
  }
  check('every key present in all 7 languages', missing.length === 0, missing.slice(0, 5).join(', '));
  const empty = probe(ctx, `Object.entries(I18N).flatMap(([l,o])=>Object.entries(o).filter(([k,v])=>!v||!String(v).trim()).map(([k])=>l+':'+k))`);
  check('no empty translations', empty.length === 0, empty.join(', '));
  // every data-i18n key used in the HTML exists in the dictionary.
  // Template-generated attributes (data-i18n="piece'+type+'") cannot be
  // resolved by a static scan — they are checked separately below.
  const used = [...html.matchAll(/data-i18n(?:-html|-ph|-aria)?="([^"]+)"/g)].map(m => m[1]);
  const unknown = [...new Set(used)].filter(k => !k.includes("'+") && !enKeys.includes(k));
  check('every data-i18n key in the HTML exists in the dictionary (' + new Set(used).size + ' used)', unknown.length === 0, unknown.join(', '));
  check('template-generated piece keys exist (pieceK..pieceP)',
    ['pieceK', 'pieceQ', 'pieceR', 'pieceB', 'pieceN', 'pieceP'].every(k => enKeys.includes(k)));
  check('advanced-settings + Xabinski keys exist',
    ['advTitle', 'advCustomize', 'advCentralPiece', 'advAxisDist', 'advAxisStdDev', 'advAxisRefMean',
     'advShuffleAxis', 'advRefSharesNote', 'advOk', 'advCancel', 'distGaussian', 'distPoisson',
     'distRayleigh', 'distUniform', 'distLabel', 'editBy', 'editParameters', 'editChance',
     'refMean', 'stdDev', 'refSharePct', 'setupRangeError', 'setupShareError',
     'xabTitle', 'xabPiece', 'xabPrev', 'xabNew', 'xabExpected', 'xabQuote', 'msgNoOpening'].every(k => enKeys.includes(k)));
  // "Xabinski" is never translated: the reveal title is the name verbatim in
  // every language, and no translation spells the name any other way.
  check('"Xabinski" is the reveal title verbatim in all 7 languages',
    langs.every(l => probe(ctx, 'I18N.' + l + '.xabTitle') === 'Xabinski!'));
  const misspelled = probe(ctx, `Object.entries(I18N).flatMap(([l,o])=>Object.values(o).flatMap(v=>[...String(v).matchAll(/xabinski/gi)].map(m=>l+':'+m[0])).filter(s=>!s.endsWith(':Xabinski')))`);
  check('no translation spells the name any other way', misspelled.length === 0, misspelled.join(', '));
  check('the Xabinski expected-shares line translates in all 7 languages',
    langs.every(l => { probe(ctx, 'setLang("' + l + '")'); const v = probe(ctx, `t('xabExpected',{mode:'X'})`); return v && v !== 'xabExpected' && v.includes('X'); }));
  check('the Xabinski quote translates in all 7 languages (name untouched)',
    langs.every(l => { const v = probe(ctx, 'I18N.' + l + '.xabQuote'); return typeof v === 'string' && v.trim().length > 0 && v !== 'xabQuote' && !/xabinski/i.test(v); })
    && probe(ctx, `I18N.en.xabQuote`) === 'You cannot predict randomness'
    && probe(ctx, `I18N.pt.xabQuote`) === 'Você não pode prever o aleatório');
  // the rules text is the NEW remote text (Rayleigh + opening filter), not
  // the old v1.2 reconstruction
  check('rule 2 is the new Rayleigh text (5% zero kings)', probe(ctx, `I18N.en.rule2`).includes('5% chance of rolling zero kings'));
  check('rule 3 is the new opening-filter text (90% re-roll)', probe(ctx, `I18N.en.rule3`).includes('90% of the time'));
  check('rule 6 is the new last-king text (stalemate is a draw)', probe(ctx, `I18N.en.rule6`).includes('Only the last king matters'));
  // t() falls back to English, then to the key itself
  check('t() falls back to the key for unknown keys', probe(ctx, `t('__no_such_key__')`) === '__no_such_key__');
  check('t() interpolates {n} / {list}', probe(ctx, `t('kingsWhite',{n:3})`).includes('3'));
  check('t() interpolates {code}', probe(ctx, `t('msgCreatingRoom',{code:'KQ7B'})`).includes('KQ7B'));
  // reason keys translate (engine reason -> UI text) in every language
  const reasonKeys = ['reasonDrawNoKings', 'reasonWhiteNoKing', 'reasonBlackNoKing', 'reasonStalemate', 'reasonRepetition', 'reasonFifty', 'resignWhite', 'resignBlack'];
  let untranslated = [];
  for (const l of langs) {
    probe(ctx, 'setLang("' + l + '")');
    for (const k of reasonKeys) {
      const v = probe(ctx, 't("' + k + '")');
      if (!v || v === k) untranslated.push(l + ':' + k);
    }
  }
  check('all 8 game-over reason keys translate in all 7 languages', untranslated.length === 0, untranslated.join(', '));
}

// ---------- switching changes visible text + persists ----------
console.log('Switching + persistence:');
{
  const ctx = makeCtx({
    storedLang: 'ja',
    seedEls(els, makeEl) {
      const tag = makeEl(); tag.dataset.i18n = 'tagline'; tag.textContent = 'EN TAGLINE'; els.taglineEl = tag;
      const pick = makeEl(); pick.dataset.i18n = 'pickMode'; pick.textContent = 'EN PICK'; els.pickEl = pick;
      const btn = makeEl(); btn.dataset.i18nHtml = 'btnCreate'; btn.innerHTML = 'EN CREATE'; els.btnEl = btn;
      const ph = makeEl(); ph.dataset.i18nPh = 'joinPh'; ph.placeholder = 'EN PH'; els.phEl = ph;
    },
  });
  check('stored language (ja) is applied on load', ctx.sandbox.document.documentElement.lang === 'ja', 'got ' + ctx.sandbox.document.documentElement.lang);
  check('visible text is Japanese on load', ctx.els.taglineEl.textContent === '毎局が新しいサイコロの目。二つとして同じ盤面はない。ずっと無料。', 'got ' + ctx.els.taglineEl.textContent);
  check('pick-a-mode heading is Japanese on load', ctx.els.pickEl.textContent === 'モードを選ぶ');
  check('html key (create button) is Japanese on load', ctx.els.btnEl.innerHTML.includes('ルームを作る'), 'got ' + ctx.els.btnEl.innerHTML.slice(0, 30));
  check('placeholder is Japanese on load', ctx.els.phEl.placeholder === 'ルームコード — 例：KQ7B', 'got ' + ctx.els.phEl.placeholder);
  check('select shows the stored language', ctx.els.langSelect.value === 'ja');
  probe(ctx, 'setLang("pt")');
  check('switching to pt updates visible text', ctx.els.taglineEl.textContent === 'Cada partida é uma nova rolada de dados. Nenhum tabuleiro é igual ao outro. Grátis para sempre.', 'got ' + ctx.els.taglineEl.textContent);
  check('switching to pt updates the document lang', ctx.sandbox.document.documentElement.lang === 'pt');
  check('switching to pt updates the select', ctx.els.langSelect.value === 'pt');
  check('choice persists in localStorage under key lang', ctx.store.lang === 'pt', 'got ' + ctx.store.lang);
  check('page title follows the language', ctx.sandbox.document.title === 'RNG Chess — Peças Aleatórias. Tudo Aleatório. Grátis.', 'got ' + ctx.sandbox.document.title);
  // a second load with the stored value restores it
  const ctx2 = makeCtx({ storedLang: ctx.store.lang });
  check('reloading with stored pt restores pt', ctx2.sandbox.document.documentElement.lang === 'pt');
}

// ---------- navigator.language mapping ----------
console.log('Browser-language mapping (no stored choice):');
{
  const cases = [['pt-BR', 'pt'], ['es-MX', 'es'], ['zh-TW', 'zh'], ['zh-CN', 'zh'], ['ja-JP', 'ja'], ['fr-CA', 'fr'], ['ko-KR', 'ko'], ['en-GB', 'en'], ['de-DE', 'en'], ['ru-RU', 'en']];
  for (const [nav, want] of cases) {
    const ctx = makeCtx({ navLang: nav });
    check('navigator.language ' + nav + ' -> ' + want, ctx.sandbox.document.documentElement.lang === want, 'got ' + ctx.sandbox.document.documentElement.lang);
  }
}

// ---------- translated game flow (status / win banner via the real render) ----------
console.log('Translated in-game status:');
{
  const ctx = makeCtx({});
  probe(ctx, 'setLang("fr")');
  probe(ctx, `startGame('pieces', 42, {playMode:'local'})`);
  const status = ctx.els.statusBox.innerHTML;
  check('French status shows "Aux Blancs de jouer"', status.includes('Aux Blancs de jouer'), 'got ' + status.slice(0, 80));
  const kings = ctx.els.kingsBox.innerHTML;
  check('French kings pill shows "Rois blancs"', kings.includes('Rois blancs'), 'got ' + kings.slice(0, 80));
  // the opening filter may re-roll the seed past 42, so assert the label + a number, not 42 itself
  check('French kings pill shows the seed label', /Graine \d+/.test(kings), 'got ' + kings.slice(0, 80));
  check('French moves box is translated', ctx.els.movesBox.innerHTML.includes('les dés ont parlé'));
  probe(ctx, 'setLang("ko")');
  const statusKo = ctx.els.statusBox.innerHTML;
  check('Korean status shows "백 차례"', statusKo.includes('백 차례'), 'got ' + statusKo.slice(0, 80));
  // resign in Korean: the over modal reason must be translated
  probe(ctx, `$('btnResign').click()`);
  check('Korean resign reason is translated', ctx.els.overReason.textContent === '백이 기권했습니다.', 'got ' + ctx.els.overReason.textContent);
  check('Korean win/draw title is translated (White resigned, so Black wins)', ctx.els.overTitle.textContent === '♚ 흑 승리!', 'got ' + ctx.els.overTitle.textContent);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
