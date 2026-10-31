/* @ds-bundle: {"format":4,"namespace":"Katubaya","components":[{"name":"Button","group":"Actions"},{"name":"Badge","group":"Status"},{"name":"OrderStatus","group":"Status"},{"name":"Lifecycle","group":"Status"},{"name":"Amount","group":"Data"},{"name":"Address","group":"Data"},{"name":"Field","group":"Forms"},{"name":"OfferCard","group":"Market"},{"name":"OfferPhoto","group":"Market"},{"name":"PhotoPicker","group":"Forms"},{"name":"Table","group":"Data"},{"name":"Notice","group":"Feedback"},{"name":"EmptyState","group":"Feedback"},{"name":"Transaction","group":"Feedback"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;
  var cx = function () { return Array.prototype.slice.call(arguments).filter(Boolean).join(' '); };

  /* Icons: single-ink, 24 grid, 1.75 stroke. Mirrors assets/Icons. */
  var PATHS = {
    check: 'M5 12.5l4.5 4.5L19 7.5',
    copy: 'M9 9h10v10H9zM5 15V5h10',
    truck: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
    package: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
    warehouse: 'M3 10l9-6 9 6v10H3zM8 20v-6h8v6M8 17h8',
    wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 7V5h13v2M16 13.5h.5',
    leaf: 'M20 4C10 4 4 9 4 17c0 1 .2 2 .5 3C13 20 20 14 20 4zM4.5 20C8 14 12 11 17 8',
    alert: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
    arrowRight: 'M4 12h16M13 5l7 7-7 7',
    close: 'M6 6l12 12M18 6L6 18',
    info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 7.5v.5',
    image: 'M4 5h16v14H4zM4 16l4.5-4.5 4 4 3-3L20 17M15.5 9.5h.5',
    plus: 'M12 5v14M5 12h14'
  };
  function Icon(props) {
    var d = PATHS[props.name] || PATHS.info;
    return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', width: props.size || 20, height: props.size || 20, className: props.className },
      h('path', { d: d }));
  }

  /* Button */
  function Button(props) {
    var variant = props.variant || 'secondary', size = props.size || 'md', icon = props.icon, children = props.children, className = props.className;
    var rest = {}; for (var k in props) if (!/^(variant|size|icon|children|className)$/.test(k)) rest[k] = props[k];
    rest.type = rest.type || 'button';
    rest.className = cx('kb-btn', 'kb-btn-' + variant, size !== 'md' && 'kb-btn-' + size, className);
    return h('button', rest, icon ? h(Icon, { name: icon, size: 18 }) : null, children);
  }

  /* Badge */
  function Badge(props) {
    return h('span', { className: cx('kb-badge', props.tone && 'kb-tone-' + props.tone, props.className) }, props.children);
  }

  /* OrderStatus — the nine on-chain statuses, fixed labels and tones */
  var STATUS = {
    ESCROWED_PICKUP: { label: 'Escrowed, pickup', tone: 'river' },
    PENDING_DELIVERY_QUOTE: { label: 'Awaiting quote', tone: 'amber' },
    DELIVERY_QUOTED: { label: 'Quote sent', tone: 'amber' },
    ESCROWED_READY: { label: 'Ready', tone: 'river' },
    IN_TRANSIT: { label: 'In transit', tone: 'canopy' },
    FULFILLED: { label: 'Fulfilled', tone: 'ink', terminal: true },
    REFUSED: { label: 'Refused', tone: 'urucum', terminal: true },
    CANCELED: { label: 'Canceled', tone: 'muted', terminal: true },
    EXPIRED: { label: 'Expired', tone: 'muted', terminal: true }
  };
  function OrderStatus(props) {
    var s = STATUS[props.status] || { label: String(props.status || 'Unknown'), tone: 'muted' };
    return h('span', { className: cx('kb-status', 'kb-tone-' + s.tone, s.terminal && 'kb-status-terminal', props.className), title: props.status },
      h('span', { className: 'kb-status-dot' }), props.label || s.label);
  }

  /* Lifecycle — pickup or delivery path with the current status placed on it */
  var PATHS_BY_MODE = {
    PICKUP: ['ESCROWED_PICKUP', 'IN_TRANSIT', 'FULFILLED'],
    DELIVERY: ['PENDING_DELIVERY_QUOTE', 'DELIVERY_QUOTED', 'ESCROWED_READY', 'IN_TRANSIT', 'FULFILLED']
  };
  var STEP_LABEL = { ESCROWED_PICKUP: 'Escrowed', PENDING_DELIVERY_QUOTE: 'Awaiting quote', DELIVERY_QUOTED: 'Quote sent', ESCROWED_READY: 'Ready', IN_TRANSIT: 'In transit', FULFILLED: 'Fulfilled' };
  var HALT_AFTER = { REFUSED: { PICKUP: 0, DELIVERY: 2 }, CANCELED: { PICKUP: 0, DELIVERY: 1 }, EXPIRED: { PICKUP: 0, DELIVERY: 2 } };
  function Lifecycle(props) {
    var mode = props.mode === 'PICKUP' ? 'PICKUP' : 'DELIVERY';
    var steps = PATHS_BY_MODE[mode];
    var status = props.status;
    var idx = steps.indexOf(status);
    var halted = HALT_AFTER[status];
    var haltAt = halted ? halted[mode] : -1;
    var items = steps.map(function (step, i) {
      var state = 'upcoming';
      if (halted) { state = i <= haltAt ? 'done' : 'upcoming'; }
      else if (i < idx) state = 'done';
      else if (i === idx) state = idx === steps.length - 1 ? 'done' : 'current';
      var icon = state === 'done' ? h(Icon, { name: 'check', size: 14 }) : (step === 'IN_TRANSIT' ? h(Icon, { name: 'truck', size: 14 }) : h('span', null, String(i + 1)));
      return h('li', { key: step, className: cx('kb-step', 'kb-step-' + state), 'aria-current': state === 'current' ? 'step' : undefined },
        h('span', { className: 'kb-step-node' }, icon),
        h('span', { className: 'kb-step-track' }),
        h('span', { className: 'kb-step-label' }, STEP_LABEL[step]));
    });
    if (halted) {
      var quiet = status !== 'REFUSED';
      items.splice(haltAt + 1, 0, h('li', { key: status, className: cx('kb-step', quiet ? 'kb-step-quiet' : 'kb-step-halt'), 'aria-current': 'step' },
        h('span', { className: 'kb-step-node' }, h(Icon, { name: quiet ? 'close' : 'alert', size: 14 })),
        h('span', { className: 'kb-step-track' }),
        h('span', { className: 'kb-step-label' }, STATUS[status].label)));
      items = items.slice(0, haltAt + 2);
    }
    return h('ol', { className: cx('kb-lifecycle', props.vertical && 'kb-lifecycle-vertical', props.className), 'aria-label': (mode === 'PICKUP' ? 'Pickup' : 'Delivery') + ' order progress' }, items);
  }

  /* Amount — minor units to a decimal with the mint symbol */
  function formatMinor(minor, decimals, locale) {
    var n = typeof minor === 'bigint' ? minor : BigInt(String(minor).replace(/[^0-9-]/g, '') || '0');
    var d = decimals == null ? 6 : decimals;
    var neg = n < BigInt(0); if (neg) n = -n;
    var base = BigInt(10) ** BigInt(d);
    var whole = n / base, frac = n % base;
    var wholeStr = whole.toLocaleString(locale || 'en-US');
    if (d === 0) return (neg ? '-' : '') + wholeStr;
    var full = frac.toString().padStart(d, '0');
    var trimmed = full.replace(/0+$/, '');
    var fracStr = full.slice(0, Math.max(Math.min(2, d), trimmed.length));
    return (neg ? '-' : '') + wholeStr + '.' + fracStr;
  }
  function Amount(props) {
    var text = formatMinor(props.minor, props.decimals, props.locale);
    return h('span', { className: cx('kb-amount', props.size === 'lg' && 'kb-amount-lg', props.escrow && 'kb-amount-escrow', props.className) },
      text, props.symbol ? h('span', { className: 'kb-amount-symbol' }, props.symbol) : null);
  }

  /* Address — shortened, copyable public key */
  function shorten(v, head, tail) { v = String(v || ''); if (v.length <= head + tail + 1) return v; return v.slice(0, head) + '…' + v.slice(-tail); }
  function Address(props) {
    var _s = React.useState(false), done = _s[0], setDone = _s[1];
    var head = props.head || 4, tail = props.tail || 4;
    function copy() {
      var p = (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(String(props.value)) : Promise.resolve();
      p.then(function () { setDone(true); setTimeout(function () { setDone(false); }, 1500); }, function () {});
    }
    return h('span', { className: cx('kb-address', props.className) },
      h('span', { title: String(props.value) }, shorten(props.value, head, tail)),
      props.copy !== false ? h('button', { type: 'button', className: cx('kb-copy', done && 'kb-copy-done'), onClick: copy, 'aria-label': done ? 'Copied' : 'Copy address' },
        h(Icon, { name: done ? 'check' : 'copy', size: 16 })) : null);
  }

  /* Field — label, control, hint or error */
  var fieldSeq = 0;
  function Field(props) {
    var id = React.useMemo(function () { return props.id || ('kb-f' + (++fieldSeq)); }, [props.id]);
    var child = props.children;
    var control = React.isValidElement(child) ? React.cloneElement(child, { id: id, 'aria-describedby': (props.error || props.hint) ? id + '-d' : undefined, 'aria-invalid': props.error ? 'true' : undefined }) : child;
    return h('div', { className: cx('kb-field', props.error && 'kb-field-invalid', props.className) },
      h('label', { className: 'kb-label', htmlFor: id }, props.label, props.optional ? h('span', { className: 'kb-label-optional' }, 'Optional') : null),
      props.affix ? h('div', { className: 'kb-input-affix' }, control, h('span', { className: 'kb-affix' }, props.affix)) : control,
      props.error ? h('div', { id: id + '-d', className: 'kb-error' }, props.error) : (props.hint ? h('div', { id: id + '-d', className: 'kb-hint' }, props.hint) : null));
  }
  function Input(props) {
    var rest = {}; for (var k in props) if (k !== 'className' && k !== 'mono') rest[k] = props[k];
    rest.className = cx('kb-input', props.mono && 'kb-input-mono', props.className);
    return h('input', rest);
  }
  function Select(props) {
    var rest = {}; for (var k in props) if (k !== 'className') rest[k] = props[k];
    rest.className = cx('kb-select', props.className);
    return h('select', rest, props.children);
  }

  /* OfferCard — a transparent listing */
  /* unit_code → [singular, plural, base units per shown unit] (README §10) */
  var UNIT = { 1: ['g', 'g', 1], 2: ['kg', 'kg', 1000], 3: ['ml', 'ml', 1], 4: ['L', 'L', 1000], 10: ['unit', 'units', 1], 11: ['bunch', 'bunches', 1], 12: ['bag', 'bags', 1], 13: ['tray', 'trays', 1], 14: ['box', 'boxes', 1] };
  function formatQty(base, unitCode) {
    var u = UNIT[unitCode] || UNIT[10];
    var v = Number(base) / u[2];
    var txt = v.toLocaleString('en-US', { maximumFractionDigits: 3 });
    return txt + ' ' + (v === 1 ? u[0] : u[1]);
  }
  /* OfferPhoto — the 4:3 photo well: the farmer's photo, or a quiet no-photo state */
  function OfferPhoto(props) {
    var size = props.size || 'card';
    return h('div', { className: cx('kb-photo', 'kb-photo-' + size, !props.src && 'kb-photo-empty', props.className) },
      props.src ? h('img', { src: props.src, alt: props.alt || '' }) :
        h('div', { className: 'kb-photo-placeholder' }, h(Icon, { name: 'image', size: size === 'thumb' ? 16 : 28 }), size === 'thumb' ? null : h('span', null, props.emptyLabel || 'No photo yet')),
      props.src && props.count > 1 && size !== 'thumb' ? h('span', { className: 'kb-photo-count' }, h(Icon, { name: 'image', size: 14 }), String(props.count)) : null);
  }

  /* PhotoPicker — a farmer adds, orders and removes an offer's photos (storage, on-chain or off-chain, still to be decided) */
  function PhotoPicker(props) {
    var photos = props.photos || [], max = props.max || 6;
    return h('div', { className: cx('kb-picker', props.className) },
      h('ul', { className: 'kb-picker-grid', 'aria-label': props.label || 'Photos' },
        photos.map(function (p, i) {
          return h('li', { key: i, className: 'kb-picker-item' },
            h(OfferPhoto, { src: p.src, alt: p.alt, size: 'tile' }),
            i === 0 ? h('span', { className: 'kb-picker-cover' }, 'Cover') : null,
            h('button', { type: 'button', className: 'kb-picker-remove', 'aria-label': 'Remove photo ' + (i + 1) }, h(Icon, { name: 'close', size: 14 })));
        }),
        photos.length < max ? h('li', { className: 'kb-picker-item' },
          h('button', { type: 'button', className: 'kb-picker-add', onClick: props.onAdd },
            h(Icon, { name: 'plus', size: 22 }), h('span', null, photos.length ? 'Add photo' : 'Add photos'))) : null),
      h('div', { className: 'kb-hint' }, props.hint || ('Up to ' + max + ' photos, JPG or PNG. The first is the cover. You can add or change them any time.')));
  }

  function OfferCard(props) {
    var active = props.active !== false && Number(props.qtyRemaining) > 0;
    var u = UNIT[props.unitCode] || UNIT[10];
    var unitName = u[0];
    var photoCount = props.photoCount != null ? Number(props.photoCount) : (props.image ? 1 : 0);
    return h('article', { className: cx('kb-offer', !active && 'kb-offer-inactive', props.className) },
      h(OfferPhoto, { src: props.image, alt: props.imageAlt || ('Photo of ' + props.crop + (props.cultivar ? ' ' + props.cultivar : '') + ' by ' + props.farmerName), count: photoCount, className: 'kb-offer-well' }),
      h('div', { className: 'kb-offer-body' },
        h('h3', { className: 'kb-offer-crop', title: props.crop + (props.cultivar ? ' ' + props.cultivar : '') }, props.crop, props.cultivar ? h('span', { className: 'kb-offer-cultivar' }, ' ' + props.cultivar) : null),
        h('div', { className: 'kb-offer-row' },
          h(Amount, { minor: props.priceMinor, decimals: props.decimals, symbol: (props.symbol || 'USDC') + ' / ' + unitName }),
          h('span', { className: 'kb-offer-meta' }, active ? formatQty(props.qtyRemaining, props.unitCode) + ' left' : 'Sold out')),
        h('div', { className: 'kb-offer-row' },
          h('div', { className: 'kb-offer-farmer' },
            h('span', { className: 'kb-offer-farmer-name' }, props.farmerName),
            props.farmerKey ? h(Address, { value: props.farmerKey, copy: false }) : null),
          h('span', { className: 'kb-offer-meta' }, props.expires ? 'Expires ' + props.expires : 'No expiry')),
        h('p', { className: 'kb-offer-meta kb-offer-notes', 'aria-hidden': props.notes ? undefined : 'true', title: props.notes || undefined }, props.notes || ''),
        h('div', { className: 'kb-offer-actions' },
          h('span', { className: 'kb-offer-meta' }, props.warehouseName ? 'Via ' + props.warehouseName : ''),
          h(Button, { variant: 'primary', size: 'sm', disabled: !active, onClick: props.onBuy }, props.buyLabel || 'Buy'))));
  }

  /* Transaction — one wallet transaction: what it does, what moves, where it is */
  var TX_STEPS = ['Approve in wallet', 'Sending to Solana', 'Confirmed'];
  var TX_AT = { sign: 0, sending: 1, confirmed: 2, failed: 1, rejected: 0 };
  function Transaction(props) {
    var state = TX_AT[props.state] != null ? props.state : 'sign';
    var at = TX_AT[state], stopped = state === 'failed' || state === 'rejected';
    var titleId = React.useMemo(function () { return 'kb-tx' + (++fieldSeq); }, []);
    var steps = TX_STEPS.map(function (label, i) {
      var s = 'upcoming';
      if (stopped) s = i < at ? 'done' : (i === at ? (state === 'failed' ? 'halt' : 'quiet') : 'upcoming');
      else if (i < at || state === 'confirmed') s = 'done';
      else if (i === at) s = 'current';
      var node = s === 'done' ? h(Icon, { name: 'check', size: 14 }) : s === 'halt' ? h(Icon, { name: 'alert', size: 14 }) : s === 'quiet' ? h(Icon, { name: 'close', size: 14 }) :
        s === 'current' ? (i === 0 ? h(Icon, { name: 'wallet', size: 14 }) : h('span', { className: 'kb-spinner', 'aria-hidden': 'true' })) : h('span', null, String(i + 1));
      return h('li', { key: i, className: cx('kb-step', 'kb-step-' + s), 'aria-current': s === 'current' || s === 'halt' || s === 'quiet' ? 'step' : undefined },
        h('span', { className: 'kb-step-node' }, node), h('span', { className: 'kb-step-track' }),
        h('span', { className: 'kb-step-label' }, stopped && i === at ? (state === 'failed' ? 'Failed' : 'Not approved') : label));
    });
    var lines = props.lines || [];
    var foot = state === 'sign' ? 'Check that your wallet shows the same amounts before you approve.'
      : state === 'sending' ? 'Usually a few seconds. You can close this window; the transaction continues.'
      : state === 'rejected' ? 'Nothing was sent and no funds moved.' : null;
    return h('div', { role: props.inline ? 'region' : 'dialog', 'aria-modal': props.inline ? undefined : 'true', 'aria-labelledby': titleId, className: cx('kb-tx', 'kb-tx-' + state, props.className) },
      h('div', { className: 'kb-tx-head' },
        h('div', { className: 'kb-tx-heading' },
          h('h2', { id: titleId, className: 'kb-tx-title' }, props.title),
          props.instruction ? h('span', { className: 'kb-tx-instr' }, 'Instruction ' + props.instruction) : null),
        props.onClose && state !== 'sending' ? h('button', { type: 'button', className: 'kb-copy kb-tx-close', onClick: props.onClose, 'aria-label': 'Close' }, h(Icon, { name: 'close', size: 18 })) : null),
      props.children ? h('p', { className: 'kb-tx-text' }, props.children) : null,
      lines.length ? h('dl', { className: 'kb-tx-lines' }, lines.map(function (l, i) {
        return h('div', { key: i, className: cx('kb-tx-line', l.total && 'kb-tx-total') },
          h('dt', null, l.label),
          h('dd', null, l.minor != null ? h(Amount, { minor: l.minor, decimals: l.decimals, symbol: l.symbol, escrow: l.escrow }) : h('span', { className: 'kb-tx-value' }, l.value),
            l.note ? h('span', { className: 'kb-tx-note' }, l.note) : null));
      })) : null,
      h('ol', { className: 'kb-lifecycle kb-tx-steps', 'aria-label': 'Transaction progress' }, steps),
      state === 'failed' && props.error ? h(Notice, { tone: 'danger', title: props.errorTitle || 'The transaction failed' }, props.error) : null,
      state === 'confirmed' && props.signature ? h('div', { className: 'kb-tx-foot' }, h('span', null, 'Signature'), h(Address, { value: props.signature, head: 6, tail: 6 }),
        props.explorerHref ? h('a', { href: props.explorerHref, target: '_blank', rel: 'noreferrer', className: 'kb-tx-link' }, 'View on explorer') : null) : null,
      foot ? h('div', { className: 'kb-tx-foot' }, foot) : null,
      props.actions ? h('div', { className: 'kb-tx-actions' }, props.actions) : null);
  }

  /* Table */
  function Table(props) {
    var cols = props.columns || [], rows = props.rows || [];
    var keyOf = props.rowKey || function (r, i) { return r.id != null ? r.id : i; };
    return h('div', { className: cx('kb-table-wrap', props.className) },
      h('table', { className: 'kb-table' },
        props.caption ? h('caption', { style: { position: 'absolute', clip: 'rect(0 0 0 0)' } }, props.caption) : null,
        h('thead', null, h('tr', null, cols.map(function (c) { return h('th', { key: c.key, scope: 'col', className: cx(c.align === 'right' && 'kb-num'), style: c.width ? { width: c.width } : undefined }, c.header); }))),
        h('tbody', null, rows.map(function (r, i) {
          return h('tr', { key: keyOf(r, i), className: cx(props.selected === keyOf(r, i) && 'kb-selected') },
            cols.map(function (c) { return h('td', { key: c.key, className: cx(c.align === 'right' && 'kb-num') }, c.render ? c.render(r) : r[c.key]); }));
        }))));
  }

  /* Notice */
  var NOTICE_ICON = { info: 'info', warning: 'alert', danger: 'alert', success: 'check' };
  function Notice(props) {
    var tone = props.tone || 'info';
    return h('div', { className: cx('kb-notice', 'kb-notice-' + tone, props.className), role: tone === 'danger' || tone === 'warning' ? 'alert' : 'status' },
      h(Icon, { name: NOTICE_ICON[tone] || 'info', className: 'kb-notice-icon' }),
      h('div', { className: 'kb-notice-body' },
        props.title ? h('div', { className: 'kb-notice-title' }, props.title) : null,
        props.children ? h('div', { className: 'kb-notice-text' }, props.children) : null),
      props.action ? h('div', { className: 'kb-notice-action' }, props.action) : null);
  }

  /* EmptyState */
  function EmptyState(props) {
    return h('div', { className: cx('kb-empty', props.className) },
      props.icon ? h(Icon, { name: props.icon, size: 24 }) : null,
      h('h3', { className: 'kb-empty-title' }, props.title),
      props.children ? h('p', { className: 'kb-empty-text' }, props.children) : null,
      props.action || null);
  }

  var ns = window.Katubaya = window.Katubaya || {};
  Object.assign(ns, { Icon: Icon, Button: Button, Badge: Badge, OrderStatus: OrderStatus, Lifecycle: Lifecycle, Amount: Amount, Address: Address, Field: Field, Input: Input, Select: Select, OfferCard: OfferCard, OfferPhoto: OfferPhoto, PhotoPicker: PhotoPicker, Table: Table, Notice: Notice, EmptyState: EmptyState, Transaction: Transaction, formatMinor: formatMinor, formatQty: formatQty, STATUS: STATUS });
})();
