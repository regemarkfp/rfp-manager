/* Phone numbers with their country code: a country picker (flag + dialling code) next to the number, saved as
   "+27 82 123 4567". A number typed with a 0 in front gets the country's code instead of the 0; one typed with + or
   00 keeps its own code. Used by the booking form, crew, bookings, call sheets, My account and WhatsApp.
     Phone.format(raw, dial)  → "+27 82 123 4567" ('' for empty)     Phone.split(value, dial) → { dial, local }
     Phone.input(value, onChange, { dial, make, ... }) → a picker + input (browser only; make = the page's h()/el()) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Phone = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // [ISO code, dialling code, name]: Southern Africa first, then the rest of Africa and the world
  const COUNTRIES = [
    ['ZA', '27', 'South Africa'], ['NA', '264', 'Namibia'], ['BW', '267', 'Botswana'], ['LS', '266', 'Lesotho'], ['SZ', '268', 'Eswatini'],
    ['ZW', '263', 'Zimbabwe'], ['MZ', '258', 'Mozambique'], ['ZM', '260', 'Zambia'], ['MW', '265', 'Malawi'], ['AO', '244', 'Angola'],
    ['KE', '254', 'Kenya'], ['TZ', '255', 'Tanzania'], ['UG', '256', 'Uganda'], ['RW', '250', 'Rwanda'], ['NG', '234', 'Nigeria'], ['GH', '233', 'Ghana'],
    ['EG', '20', 'Egypt'], ['MA', '212', 'Morocco'], ['MU', '230', 'Mauritius'], ['CD', '243', 'DR Congo'], ['ET', '251', 'Ethiopia'],
    ['GB', '44', 'United Kingdom'], ['IE', '353', 'Ireland'], ['US', '1', 'United States / Canada'], ['AU', '61', 'Australia'], ['NZ', '64', 'New Zealand'],
    ['NL', '31', 'Netherlands'], ['BE', '32', 'Belgium'], ['DE', '49', 'Germany'], ['FR', '33', 'France'], ['PT', '351', 'Portugal'], ['ES', '34', 'Spain'],
    ['IT', '39', 'Italy'], ['CH', '41', 'Switzerland'], ['AT', '43', 'Austria'], ['SE', '46', 'Sweden'], ['NO', '47', 'Norway'], ['DK', '45', 'Denmark'],
    ['FI', '358', 'Finland'], ['PL', '48', 'Poland'], ['GR', '30', 'Greece'], ['AE', '971', 'United Arab Emirates'], ['SA', '966', 'Saudi Arabia'],
    ['QA', '974', 'Qatar'], ['IL', '972', 'Israel'], ['IN', '91', 'India'], ['PK', '92', 'Pakistan'], ['CN', '86', 'China'], ['JP', '81', 'Japan'],
    ['KR', '82', 'South Korea'], ['SG', '65', 'Singapore'], ['MY', '60', 'Malaysia'], ['PH', '63', 'Philippines'], ['BR', '55', 'Brazil'],
    ['AR', '54', 'Argentina'], ['MX', '52', 'Mexico']
  ];
  const DIALS = [...new Set(COUNTRIES.map((c) => c[1]))].sort((a, b) => b.length - a.length);   // longest first
  const flag = (iso) => String(iso).toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
  const digits = (s) => String(s || '').replace(/\D/g, '');
  const clean = (d) => digits(d) || '27';

  // "+27 82 123 4567" → { dial: '27', local: '82 123 4567' }; a number without a code keeps the default
  function split(value, dial) {
    const s = String(value || '').trim();
    if (/^(\+|00)/.test(s)) {
      const n = digits(s).replace(/^00/, '');
      const d = DIALS.find((x) => n.startsWith(x));
      if (d) return { dial: d, local: group(n.slice(d.length)) };
      return { dial: n.slice(0, 3), local: group(n.slice(3)) };
    }
    return { dial: clean(dial), local: s };
  }
  // the national number in readable groups (2 3 4 for nine digits, as in South Africa)
  function group(n) {
    n = digits(n);
    if (n.length === 9) return `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`;
    if (n.length === 10) return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
    return n.replace(/(\d{3})(?=\d{4,})/g, '$1 ');
  }
  // any way of writing it → "+<code> <number>"; text that is not a number at all is left as typed
  function format(raw, dial) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/[a-z]/i.test(s) && digits(s).length < 6) return s;
    if (/^(\+|00)/.test(s)) { const p = split(s); return `+${p.dial} ${p.local}`.trim(); }
    const n = digits(s).replace(/^0+/, '');
    if (!n) return s;
    return `+${clean(dial)} ${group(n)}`;
  }

  // the picker and the number as one field (browser): onChange gets the formatted number, or '' when empty
  function input(value, onChange, o) {
    o = o || {};
    const make = o.make, p = split(value, o.dial);
    let dial = p.dial;
    const opts = COUNTRIES.slice();
    if (!opts.some((c) => c[1] === dial)) opts.unshift(['', dial, '+' + dial]);
    const known = new Set();
    const sel = make('select', { class: 'phone-cc', 'aria-label': 'Country code', title: 'Country code', disabled: o.readonly || null, onchange: (e) => { dial = e.target.value.split('|')[1]; emit(); } },
      opts.map((c) => { const v = c[0] + '|' + c[1]; const first = !known.has(c[1]) && c[1] === dial; if (first) known.add(c[1]); return make('option', { value: v, selected: first || null }, `${c[0] ? flag(c[0]) + ' ' : ''}+${c[1]}  ${c[0] ? c[2] : ''}`.trim()); }));
    const num = make('input', { type: 'tel', class: 'phone-num', autocomplete: o.autocomplete || 'tel-national', placeholder: o.placeholder || (dial === '27' ? '82 123 4567' : 'Number'), value: p.local, readonly: o.readonly || null, required: o.required || null,
      oninput: () => { const v = num.value.trim(); if (/^(\+|00)/.test(v) && digits(v).length > 4) { const q = split(v); const opt = [...sel.options].find((x) => x.value.endsWith('|' + q.dial)); if (opt) { sel.value = opt.value; dial = q.dial; num.value = q.local; } } emit(); },
      onblur: () => { const v = num.value.trim(); if (v && !/[a-z]/i.test(v)) num.value = group(digits(v).replace(/^0+/, '')); } });
    function emit() { onChange(num.value.trim() ? format(/^(\+|00)/.test(num.value.trim()) ? num.value : num.value.replace(/^\s*0+/, ''), dial).replace(/^\+(\d+) $/, '') : ''); }
    const box = make('div', { class: 'phone-field', style: { display: 'flex', gap: '6px', alignItems: 'stretch' } }, sel, num);
    sel.style.width = '96px'; sel.style.flex = '0 0 96px'; num.style.flex = '1 1 auto'; num.style.minWidth = '0';
    return box;
  }

  return { COUNTRIES, split, format, group, input, flag };
});
