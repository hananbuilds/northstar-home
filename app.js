/* ============ NORTHSTAR HOME DASHBOARD — VELYNT ============ */
/* ============ GOOGLE SHEETS DATA SOURCE (refreshable) ============ */
/* Paste your Google Sheet ID here (the long id in the sheet's URL, between /d/ and /edit).
   The sheet must be shared as "Anyone with the link – Viewer" for this to work, since this
   is a static page with no backend/API key — it fetches the sheet directly from the browser.
   This is fine for an internal/portfolio sheet; do NOT use this approach for confidential
   client data without a private server-side proxy instead. */
const SHEET_ID = '1Tf17eqrKx6zGiNwvd3mH7BsWJXspisEOXAxYazJ3XLc';
const SHEET_TABS = { sales:'Sales', returns:'Returns', marketing:'Marketing', products:'Products', customers:'Customers' };
/* For local/dev testing only: point this at a mock server instead of Google (see test harness). */
const GVIZ_BASE_OVERRIDE = (typeof window!=='undefined' && window.__GVIZ_BASE_OVERRIDE__) || null;

/* Column header -> internal field name, one map per tab. Headers must match the sheet exactly
   (they mirror the Clean_* columns from the source workbook). */
const FIELD_MAPS = {
  sales: {
    'Order ID (Clean)':'id', 'Order Date':'date', 'Customer ID':'cust', 'SKU':'sku', 'Product Name':'product',
    'Category (Clean)':'cat', 'Country (Clean)':'country', 'Sales Channel':'channel', 'Quantity':'qty',
    'Unit Price':'price', 'Discount (%) (Clean)':'disc', 'Shipping Revenue (Clean)':'ship', 'Tax':'tax',
    'Total Amount':'total', 'Cost':'cost', 'Is Revenue Order':'rev', 'Order Status':'status'
  },
  returns: {
    'Return ID':'id', 'Order ID (Clean)':'orderId', 'Return Date':'date', 'Customer ID':'cust', 'Product SKU':'sku',
    'Reason (Clean)':'reason', 'Quantity Returned':'qty', 'Refund Amount':'refund', 'Return Status':'status'
  },
  marketing: {
    'Date':'date', 'Channel (Clean)':'channel', 'Campaign':'campaign', 'Impressions':'impr', 'Clicks':'clicks',
    'Spend (Clean)':'spend', 'Leads':'leads', 'Orders':'orders', 'Revenue':'revenue',
    'Conversion Rate':'conv', 'Conversion Rate Valid':'convValid', 'ROAS':'roas'
  },
  products: {
    'SKU':'sku', 'Product Name':'name', 'Category (Clean)':'cat', 'Subcategory':'subcat',
    'Unit Cost':'cost', 'Standard Price':'price', 'Inventory':'inventory', 'Product Status':'status'
  },
  customers: {
    'Customer ID':'id', 'Country (Clean)':'country', 'Customer Segment':'segment', 'Acquisition Source (Clean)':'acq',
    'Lifetime Value':'ltv', 'Signup Date':'signup', 'Last Order Date':'lastOrder'
  }
};
const BOOL_FIELDS = { sales:['rev'], marketing:['convValid'] };

function gvizUrl(tabName){
  var base = GVIZ_BASE_OVERRIDE || ('https://docs.google.com/spreadsheets/d/'+SHEET_ID);
  /* cache-buster (_=timestamp) plus cache:'no-store' below ensures "Refresh Data" always gets
     the current sheet contents rather than a stale browser-cached response for the same URL */
  return base + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(tabName) + '&_=' + Date.now();
}
function parseGvizResponse(text){
  var start = text.indexOf('(');
  var end = text.lastIndexOf(')');
  return JSON.parse(text.slice(start+1, end));
}
function coerceCell(val, fieldName, datasetKey){
  if(val===null || val===undefined || val==='') return null;
  var boolFields = BOOL_FIELDS[datasetKey] || [];
  if(boolFields.indexOf(fieldName)>=0){
    if(typeof val === 'boolean') return val;
    var s = String(val).trim().toUpperCase();
    return (s==='TRUE' || s==='YES' || s==='1');
  }
  return val;
}
function gvizTableToRecords(table, datasetKey){
  var map = FIELD_MAPS[datasetKey];
  var cols = table.cols.map(function(c){ return map[c.label] || null; });
  return table.rows.map(function(row){
    var rec = {};
    (row.c||[]).forEach(function(cell, i){
      var field = cols[i];
      if(!field) return;
      var raw = cell ? cell.v : null;
      /* gviz serializes date cells as "Date(YYYY,M,D)" text — normalize to YYYY-MM-DD */
      if(typeof raw === 'string' && raw.indexOf('Date(')===0){
        var parts = raw.slice(5,-1).split(',').map(Number);
        raw = new Date(parts[0], parts[1], parts[2]).toISOString().slice(0,10);
      }
      rec[field] = coerceCell(raw, field, datasetKey);
    });
    return rec;
  });
}
async function fetchSheetTab(datasetKey){
  var tabName = SHEET_TABS[datasetKey];
  var resp = await fetch(gvizUrl(tabName), { cache: 'no-store' });
  if(!resp.ok) throw new Error('Could not load the "'+tabName+'" tab (HTTP '+resp.status+'). Check the sheet is shared as "Anyone with the link – Viewer".');
  var json = parseGvizResponse(await resp.text());
  return gvizTableToRecords(json.table, datasetKey);
}
async function fetchNorthstarData(){
  var keys = ['sales','returns','marketing','products','customers'];
  var results = await Promise.all(keys.map(fetchSheetTab));
  var data = {};
  keys.forEach(function(k,i){ data[k] = results[i]; });
  return data;
}

/* ---------- Derived structures — populated by buildDerivedData() once data has loaded ---------- */
let RAW, ordersById, productBySku, CATS, CHANNELS, COUNTRIES;
const PERIOD_START = '2025-01-01';
const PERIOD_END = '2025-12-31';

function buildDerivedData(){
  ordersById = {};
  RAW.sales.forEach(function(r){ ordersById[r.id] = r; });
  productBySku = {};
  RAW.products.forEach(function(p){ productBySku[p.sku] = p; });

  /* enrich returns with joined order attributes (category/channel/country/order date) */
  RAW.returns.forEach(function(r){
    var o = ordersById[r.orderId];
    r._cat = o ? o.cat : null;
    r._channel = o ? o.channel : null;
    r._country = o ? o.country : null;
    r._orderDate = o ? o.date : null;
  });

  CATS = Array.from(new Set(RAW.sales.map(function(r){return r.cat;}))).sort();
  CHANNELS = Array.from(new Set(RAW.sales.map(function(r){return r.channel;}))).sort();
  COUNTRIES = Array.from(new Set(RAW.sales.map(function(r){return r.country;}))).sort();
}
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const COLORS = ['#4C7DFF','#7EA2FF','#3DBE8B','#E0685F','#C99BFF','#F2B84B'];

/* ---------- Formatting ---------- */
function fmtCurrency(v, decimals){
  if(v===null||v===undefined||isNaN(v)) return '—';
  decimals = decimals===undefined?0:decimals;
  return '$' + v.toLocaleString('en-US',{minimumFractionDigits:decimals, maximumFractionDigits:decimals});
}
function fmtCurrencyCompact(v){
  if(v===null||v===undefined||isNaN(v)) return '—';
  var abs = Math.abs(v);
  if(abs>=1000000) return '$'+(v/1000000).toFixed(2)+'M';
  if(abs>=1000) return '$'+(v/1000).toFixed(1)+'K';
  return fmtCurrency(v,0);
}
function fmtNum(v){
  if(v===null||v===undefined||isNaN(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}
function fmtPct(v, decimals){
  if(v===null||v===undefined||isNaN(v)) return '—';
  decimals = decimals===undefined?1:decimals;
  return v.toFixed(decimals)+'%';
}
function fmtDate(d){
  var dt = new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-US',{month:'short', day:'numeric', year:'numeric'});
}
function isMobileWidth(){ return window.innerWidth <= 640; }
function esc(s){
  if(s===null||s===undefined) return '';
  return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}

/* ---------- Filter state ---------- */
const state = {
  start: PERIOD_START,
  end: PERIOD_END,
  country: 'All',
  channel: 'All',
  category: 'All',
  page: 'overview'
};

function inRange(dateStr, start, end){ return dateStr >= start && dateStr <= end; }

function matchesFilters(row, opts){
  opts = opts || {};
  if(!inRange(row.date, state.start, state.end)) return false;
  if(state.country!=='All' && row.country!==state.country) return false;
  if(state.channel!=='All' && row.channel!==state.channel) return false;
  if(state.category!=='All' && row.cat!==state.category) return false;
  return true;
}

function getFilteredSales(){
  return RAW.sales.filter(function(r){ return matchesFilters(r); });
}
function getFilteredReturns(){
  return RAW.returns.filter(function(r){
    if(!r._orderDate) return false;
    if(!inRange(r._orderDate, state.start, state.end)) return false;
    if(state.country!=='All' && r._country!==state.country) return false;
    if(state.channel!=='All' && r._channel!==state.channel) return false;
    if(state.category!=='All' && r._cat!==state.category) return false;
    return true;
  });
}
function getFilteredMarketing(){
  /* Marketing uses ad-platform channels (Google Ads, Meta Ads, Organic, Affiliate, Email) —
     a different taxonomy from Sales Channel (Shopify/Amazon/Retail Partner), so only the
     date range filter applies here; country/category/sales-channel filters do not. */
  return RAW.marketing.filter(function(r){ return inRange(r.date, state.start, state.end); });
}

/* ---------- Core KPI computation ---------- */
function computeKpis(salesRows, returnRows){
  var rev = salesRows.filter(function(r){return r.rev;});
  var revenue = rev.reduce(function(a,r){return a+r.total;},0);
  var orders = rev.length;
  var units = rev.reduce(function(a,r){return a+r.qty;},0);
  var cost = rev.reduce(function(a,r){return a+r.cost;},0);
  var grossProfit = revenue - cost;
  var grossMargin = revenue>0 ? (grossProfit/revenue*100) : null;
  var aov = orders>0 ? revenue/orders : null;
  var returnCount = returnRows.length;
  var returnRate = orders>0 ? (returnCount/orders*100) : null;
  var returnRevenue = returnRows.reduce(function(a,r){return a+r.refund;},0);
  return {revenue:revenue, orders:orders, units:units, cost:cost, grossProfit:grossProfit,
          grossMargin:grossMargin, aov:aov, returnCount:returnCount, returnRate:returnRate,
          returnRevenue:returnRevenue};
}

function addDays(dateStr, days){
  var d = new Date(dateStr+'T00:00:00');
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}
function daysBetween(a,b){
  return Math.round((new Date(b+'T00:00:00') - new Date(a+'T00:00:00'))/86400000)+1;
}

/* Comparison: default full-year view compares H2 vs H1 2025 (both real, calculable).
   Narrower ranges compare to the immediately preceding equal-length window, only if that
   window is fully within the available data period (2025-01-01+). Otherwise no comparison
   is fabricated — the dashboard says so. */
function getComparisonWindows(){
  if(state.start===PERIOD_START && state.end===PERIOD_END){
    return {curStart:'2025-07-01', curEnd:'2025-12-31', prevStart:'2025-01-01', prevEnd:'2025-06-30', label:'H2 vs H1 2025', available:true};
  }
  var len = daysBetween(state.start, state.end);
  var prevEnd = addDays(state.start, -1);
  var prevStart = addDays(prevEnd, -(len-1));
  if(prevStart < PERIOD_START){
    return {available:false};
  }
  return {curStart:state.start, curEnd:state.end, prevStart:prevStart, prevEnd:prevEnd, label:'vs previous period', available:true};
}

function rowsInWindow(rows, start, end){
  return rows.filter(function(r){ return inRange(r.date, start, end); });
}

function pctChange(cur, prev){
  if(prev===0 || prev===null || prev===undefined || isNaN(prev)) return null;
  return (cur-prev)/Math.abs(prev)*100;
}
/* ============ CHART PRIMITIVES (hand-rolled SVG) ============ */
const tooltipEl = document.getElementById('tooltip');
function showTooltip(x, y, html){
  tooltipEl.innerHTML = html;
  tooltipEl.style.left = x+'px';
  tooltipEl.style.top = y+'px';
  tooltipEl.classList.add('show');
}
function hideTooltip(){ tooltipEl.classList.remove('show'); }

/* ---- Sparkline (mini area chart, no axes) ---- */
function sparklineSVG(values, color){
  var w=64,h=26,pad=2;
  if(!values.length) return '';
  var max = Math.max.apply(null, values), min = Math.min.apply(null, values);
  if(max===min){max=max+1;}
  var step = (w-pad*2)/(values.length-1||1);
  var pts = values.map(function(v,i){
    var x = pad+i*step;
    var y = pad+(1-(v-min)/(max-min))*(h-pad*2);
    return [x,y];
  });
  var line = pts.map(function(p,i){return (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1);}).join(' ');
  var area = line + ' L'+pts[pts.length-1][0].toFixed(1)+','+(h-pad)+' L'+pts[0][0].toFixed(1)+','+(h-pad)+' Z';
  var uid = 'sp'+Math.random().toString(36).slice(2,8);
  return '<svg viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'" preserveAspectRatio="none">'+
    '<defs><linearGradient id="'+uid+'" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0%" stop-color="'+color+'" stop-opacity="0.35"/>'+
    '<stop offset="100%" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+area+'" fill="url(#'+uid+')" stroke="none"/>'+
    '<path d="'+line+'" fill="none" stroke="'+color+'" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'+
    '</svg>';
}

/* ---- Area/line chart with tooltips (monthly revenue trend) ---- */
function areaChart(container, labels, series, opts){
  opts = opts || {};
  var w = container.clientWidth || 640, h = opts.height || 240;
  var padL=44, padR=16, padT=16, padB=28;
  var innerW = w-padL-padR, innerH = h-padT-padB;
  var max = Math.max.apply(null, series.concat([0]));
  var niceMax = max<=0 ? 10 : max*1.15;
  var n = labels.length;
  var stepX = n>1 ? innerW/(n-1) : innerW;

  function xAt(i){ return padL + i*stepX; }
  function yAt(v){ return padT + innerH - (v/niceMax)*innerH; }

  var linePts = series.map(function(v,i){ return [xAt(i), yAt(v)]; });
  var lineD = linePts.map(function(p,i){ return (i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1); }).join(' ');
  var areaD = lineD + ' L'+xAt(n-1).toFixed(1)+','+(padT+innerH)+' L'+xAt(0).toFixed(1)+','+(padT+innerH)+' Z';

  var gridLines = '';
  var ticks = 4;
  for(var t=0;t<=ticks;t++){
    var val = niceMax*t/ticks;
    var y = yAt(val);
    gridLines += '<line x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(w-padR)+'" y2="'+y.toFixed(1)+'" stroke="rgba(148,163,184,0.09)" stroke-width="1"/>';
    gridLines += '<text x="'+(padL-8)+'" y="'+(y+3).toFixed(1)+'" text-anchor="end" font-size="9.5" fill="#64748B" font-family="Inter">'+fmtCurrencyCompact(val)+'</text>';
  }
  var xLabels = labels.map(function(lb,i){
    if(n>8 && i%2!==0) return '';
    return '<text x="'+xAt(i).toFixed(1)+'" y="'+(h-8)+'" text-anchor="middle" font-size="9.5" fill="#64748B" font-family="Inter">'+esc(lb)+'</text>';
  }).join('');

  var dots = linePts.map(function(p,i){
    return '<circle class="pt" data-i="'+i+'" cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="10" fill="transparent"/>';
  }).join('');
  var visDots = linePts.map(function(p,i){
    return '<circle cx="'+p[0].toFixed(1)+'" cy="'+p[1].toFixed(1)+'" r="2.6" fill="#070D1A" stroke="var(--accent2)" stroke-width="1.6"/>';
  }).join('');

  var uid = 'ar'+Math.random().toString(36).slice(2,8);
  var svg = '<svg viewBox="0 0 '+w+' '+h+'" width="100%" height="'+h+'" style="overflow:visible">'+
    '<defs><linearGradient id="'+uid+'" x1="0" y1="0" x2="0" y2="1">'+
    '<stop offset="0%" stop-color="#4C7DFF" stop-opacity="0.32"/>'+
    '<stop offset="100%" stop-color="#4C7DFF" stop-opacity="0"/></linearGradient></defs>'+
    gridLines +
    '<path d="'+areaD+'" fill="url(#'+uid+')"/>'+
    '<path d="'+lineD+'" fill="none" stroke="#4C7DFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'+
    visDots + xLabels + dots +
    '</svg>';
  container.innerHTML = svg;

  var svgEl = container.querySelector('svg');
  svgEl.querySelectorAll('.pt').forEach(function(c){
    c.addEventListener('mousemove', function(e){
      var i = +c.getAttribute('data-i');
      var extra = opts.tooltipExtra ? opts.tooltipExtra(i) : '';
      showTooltip(e.clientX, e.clientY, '<div class="t-title">'+esc(labels[i])+'</div><div class="t-row">Revenue<b>'+fmtCurrency(series[i])+'</b></div>'+extra);
    });
    c.addEventListener('mouseleave', hideTooltip);
  });
}

/* ---- Donut chart with center total + hover ---- */
function donutChart(container, data, opts){
  opts = opts || {};
  var mobile = isMobileWidth();
  var w = opts.size || (mobile?136:168), h=w, cx=w/2, cy=h/2, rOuter=w*0.452, rInner=w*0.298;
  var total = data.reduce(function(a,d){return a+d.value;},0);
  var angle = -Math.PI/2;
  var paths = '';
  data.forEach(function(d,i){
    var frac = total>0 ? d.value/total : 0;
    var a0 = angle, a1 = angle + frac*Math.PI*2;
    angle = a1;
    var largeArc = (a1-a0) > Math.PI ? 1 : 0;
    var x0o=cx+rOuter*Math.cos(a0), y0o=cy+rOuter*Math.sin(a0);
    var x1o=cx+rOuter*Math.cos(a1), y1o=cy+rOuter*Math.sin(a1);
    var x0i=cx+rInner*Math.cos(a1), y0i=cy+rInner*Math.sin(a1);
    var x1i=cx+rInner*Math.cos(a0), y1i=cy+rInner*Math.sin(a0);
    var d_ = 'M'+x0o.toFixed(2)+','+y0o.toFixed(2)+
      ' A'+rOuter+','+rOuter+' 0 '+largeArc+' 1 '+x1o.toFixed(2)+','+y1o.toFixed(2)+
      ' L'+x0i.toFixed(2)+','+y0i.toFixed(2)+
      ' A'+rInner+','+rInner+' 0 '+largeArc+' 0 '+x1i.toFixed(2)+','+y1i.toFixed(2)+' Z';
    paths += '<path d="'+d_+'" fill="'+d.color+'" class="seg" data-i="'+i+'" stroke="'+getComputedStyle(document.documentElement).getPropertyValue('--card')+'" stroke-width="1.5"/>';
  });
  var centerLabel = opts.centerLabel || 'Total';
  var centerVal = opts.centerValue || fmtCurrencyCompact(total);
  var svg = '<svg viewBox="0 0 '+w+' '+h+'" width="'+w+'" height="'+h+'">'+paths+
    '<text x="'+cx+'" y="'+(cy-4)+'" text-anchor="middle" font-size="9.5" fill="#94A3B8" font-family="Inter">'+esc(centerLabel)+'</text>'+
    '<text x="'+cx+'" y="'+(cy+14)+'" text-anchor="middle" font-size="15" font-weight="800" fill="#F5F7FA" font-family="Inter">'+esc(centerVal)+'</text>'+
    '</svg>';
  container.innerHTML = svg;
  var svgEl = container.querySelector('svg');
  svgEl.querySelectorAll('.seg').forEach(function(seg){
    seg.addEventListener('mousemove', function(e){
      var i = +seg.getAttribute('data-i');
      var d = data[i];
      var pct = total>0 ? (d.value/total*100) : 0;
      showTooltip(e.clientX, e.clientY, '<div class="t-title">'+esc(d.label)+'</div><div class="t-row">Revenue<b>'+fmtCurrency(d.value)+'</b></div><div class="t-row">Share<b>'+fmtPct(pct)+'</b></div>');
      seg.style.opacity = 0.85;
    });
    seg.addEventListener('mouseleave', function(){ hideTooltip(); seg.style.opacity=1; });
  });
}

function legendHTML(data, total){
  return data.map(function(d){
    var pct = total>0 ? (d.value/total*100) : 0;
    return '<div class="legend-row"><span class="legend-dot" style="background:'+d.color+'"></span>'+
      '<span class="legend-label">'+esc(d.label)+'</span>'+
      '<span class="legend-val">'+fmtCurrencyCompact(d.value)+'</span>'+
      '<span class="legend-pct">'+fmtPct(pct)+'</span></div>';
  }).join('');
}

/* ---- Horizontal bar list ---- */
function barListHTML(data, opts){
  opts = opts || {};
  var max = Math.max.apply(null, data.map(function(d){return Math.abs(d.value);}).concat([1]));
  var rows = data.map(function(d){
    var pct = Math.max(2, Math.abs(d.value)/max*100);
    var valStr = opts.fmt ? opts.fmt(d.value) : fmtCurrencyCompact(d.value);
    var subStr = d.sub ? ' <span style="color:var(--text3); font-weight:500;">· '+esc(d.sub)+'</span>' : '';
    return '<div class="bar-row"><div class="bar-top"><span class="bar-name">'+esc(d.label)+subStr+'</span><span class="bar-val">'+valStr+'</span></div>'+
      '<div class="bar-track"><div class="bar-fill'+(d.value<0?' neg':'')+'" style="width:'+pct.toFixed(1)+'%"></div></div></div>';
  }).join('');
  var cls = opts.columns===2 ? 'barlist-2col' : 'barlist';
  return '<div class="'+cls+'">'+rows+'</div>';
}
/* ============ MONTH GROUPING ============ */
function monthKeysInRange(start, end){
  var keys = [];
  for(var m=0; m<12; m++){
    var mStart = '2025-'+String(m+1).padStart(2,'0')+'-01';
    var mEndDate = new Date(2025, m+1, 0);
    var mEnd = mEndDate.toISOString().slice(0,10);
    if(mEnd < start || mStart > end) continue;
    keys.push({key:m, label:MONTH_NAMES[m], mStart:mStart, mEnd:mEnd});
  }
  return keys;
}
function monthlySeries(rows, valueFn){
  var months = monthKeysInRange(state.start, state.end);
  var sums = months.map(function(){return 0;});
  rows.forEach(function(r){
    var m = +r.date.slice(5,7)-1;
    var idx = months.findIndex(function(mo){return mo.key===m;});
    if(idx>=0) sums[idx]+= (valueFn?valueFn(r):1);
  });
  return {labels:months.map(function(m){return m.label;}), values:sums};
}

function groupSum(rows, keyFn, valFn){
  var map = {};
  rows.forEach(function(r){
    var k = keyFn(r);
    if(k===null||k===undefined) return;
    map[k] = (map[k]||0) + valFn(r);
  });
  return map;
}
function groupCount(rows, keyFn){
  var map = {};
  rows.forEach(function(r){
    var k = keyFn(r);
    if(k===null||k===undefined) return;
    map[k] = (map[k]||0) + 1;
  });
  return map;
}
function sortedEntries(map){
  return Object.keys(map).map(function(k){return [k,map[k]];}).sort(function(a,b){return b[1]-a[1];});
}

/* ============ INSIGHTS (computed from full-year validated baseline, unaffected by filters) ============ */
function computeInsights(){
  var rev = RAW.sales.filter(function(r){return r.rev;});
  var totalRevenue = rev.reduce(function(a,r){return a+r.total;},0);

  /* 1. Peak month */
  var byMonth = groupSum(rev, function(r){return +r.date.slice(5,7);}, function(r){return r.total;});
  var peakEntries = sortedEntries(byMonth);
  var peakMonthNum = +peakEntries[0][0];
  var peakVal = peakEntries[0][1];
  var peakShare = peakVal/totalRevenue*100;

  /* 2. Top category */
  var byCat = groupSum(rev, function(r){return r.cat;}, function(r){return r.total;});
  var catEntries = sortedEntries(byCat);
  var topCat = catEntries[0][0], topCatVal = catEntries[0][1];
  var topCatShare = topCatVal/totalRevenue*100;

  /* 3. Best ROAS channel among channels with measurable spend */
  var mktByChannel = {};
  RAW.marketing.forEach(function(m){
    if(!mktByChannel[m.channel]) mktByChannel[m.channel] = {spend:0, revenue:0};
    mktByChannel[m.channel].spend += (m.spend||0);
    mktByChannel[m.channel].revenue += (m.revenue||0);
  });
  var roasList = Object.keys(mktByChannel).filter(function(c){return mktByChannel[c].spend>0;})
    .map(function(c){return {channel:c, roas:mktByChannel[c].revenue/mktByChannel[c].spend, spend:mktByChannel[c].spend};})
    .sort(function(a,b){return b.roas-a.roas;});
  var bestRoas = roasList[0];

  /* 4. Product with high return rate (min 8 orders in the year for statistical relevance) */
  var ordersBySku = groupCount(rev, function(r){return r.sku;});
  var returnsBySku = groupCount(RAW.returns, function(r){return r.sku;});
  var overallReturnRate = RAW.returns.length/rev.length*100;
  var skuRates = Object.keys(ordersBySku).filter(function(sku){return ordersBySku[sku]>=8;})
    .map(function(sku){
      var rc = returnsBySku[sku]||0;
      return {sku:sku, name:(productBySku[sku]?productBySku[sku].name:sku), orders:ordersBySku[sku], returns:rc, rate: rc/ordersBySku[sku]*100};
    }).sort(function(a,b){return b.rate-a.rate;});
  var worstProduct = skuRates[0];

  /* 5. Channel mix — top sales channel */
  var byChannel = groupSum(rev, function(r){return r.channel;}, function(r){return r.total;});
  var chEntries = sortedEntries(byChannel);
  var topChannel = chEntries[0][0], topChannelShare = chEntries[0][1]/totalRevenue*100;

  var out = [];
  out.push({icon:'trend', html:'Revenue peaked in <b>'+MONTH_NAMES[peakMonthNum-1]+'</b>, at '+fmtCurrency(peakVal)+' — <b>'+fmtPct(peakShare)+'</b> of annual revenue.'});
  out.push({icon:'pie', html:'<b>'+esc(topCat)+'</b> generated the largest share of revenue at <b>'+fmtPct(topCatShare)+'</b> ('+fmtCurrency(topCatVal)+').'});
  if(bestRoas){
    out.push({icon:'target', html:'<b>'+esc(bestRoas.channel)+'</b> delivered the strongest ROAS among channels with measurable spend, at <b>'+bestRoas.roas.toFixed(2)+'x</b>.'});
  }
  if(worstProduct && worstProduct.rate > overallReturnRate*1.5){
    out.push({icon:'alert', html:'<b>'+esc(worstProduct.name)+'</b> shows an unusually high return rate of <b>'+fmtPct(worstProduct.rate)+'</b> vs. the store-wide average of '+fmtPct(overallReturnRate)+' (min. 8 orders).'});
  }
  out.push({icon:'grid', html:'<b>'+esc(topChannel)+'</b> is the leading sales channel, contributing <b>'+fmtPct(topChannelShare)+'</b> of annual revenue.'});
  return out;
}

const INSIGHT_ICONS = {
  trend:'<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
  pie:'<path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 2v10l7 7"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  alert:'<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/>',
  grid:'<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>'
};
/* ============ KPI ROW ============ */
function nonDateFilteredSales(){
  return RAW.sales.filter(function(r){
    if(state.country!=='All' && r.country!==state.country) return false;
    if(state.channel!=='All' && r.channel!==state.channel) return false;
    if(state.category!=='All' && r.cat!==state.category) return false;
    return true;
  });
}
function nonDateFilteredReturns(){
  return RAW.returns.filter(function(r){
    if(!r._orderDate) return false;
    if(state.country!=='All' && r._country!==state.country) return false;
    if(state.channel!=='All' && r._channel!==state.channel) return false;
    if(state.category!=='All' && r._cat!==state.category) return false;
    return true;
  });
}
function rowsInWindowBy(rows, field, start, end){
  return rows.filter(function(r){ return inRange(r[field], start, end); });
}

const KPI_DEFS = [
  {key:'revenue', label:'Total Revenue', fmt:function(v){return fmtCurrency(v);}, spark:function(m){return m.revenue;}},
  {key:'orders', label:'Total Orders', fmt:function(v){return fmtNum(v);}, spark:function(m){return m.orders;}},
  {key:'aov', label:'Average Order Value', fmt:function(v){return fmtCurrency(v,2);}, spark:function(m){return m.aov;}},
  {key:'grossProfit', label:'Gross Profit', fmt:function(v){return fmtCurrency(v);}, spark:function(m){return m.grossProfit;}},
  {key:'grossMargin', label:'Gross Margin', fmt:function(v){return fmtPct(v);}, spark:function(m){return m.grossMargin;}},
  {key:'returnRate', label:'Return Rate', fmt:function(v){return fmtPct(v);}, spark:function(m){return m.returnRate;}}
];

function monthlyKpiSeries(){
  var months = monthKeysInRange(state.start, state.end);
  var sales = getFilteredSales().filter(function(r){return r.rev;});
  var returns = getFilteredReturns();
  return months.map(function(mo){
    var sRows = sales.filter(function(r){ return +r.date.slice(5,7)-1 === mo.key; });
    var rRows = returns.filter(function(r){ return +r._orderDate.slice(5,7)-1 === mo.key; });
    var revenue = sRows.reduce(function(a,r){return a+r.total;},0);
    var orders = sRows.length;
    var cost = sRows.reduce(function(a,r){return a+r.cost;},0);
    var grossProfit = revenue-cost;
    return {
      revenue: revenue,
      orders: orders,
      aov: orders>0?revenue/orders:0,
      grossProfit: grossProfit,
      grossMargin: revenue>0?grossProfit/revenue*100:0,
      returnRate: orders>0? rRows.length/orders*100 : 0
    };
  });
}

function renderKpiRow(){
  var sales = getFilteredSales();
  var returns = getFilteredReturns();
  var kpis = computeKpis(sales, returns);
  var monthly = monthlyKpiSeries();
  var cmp = getComparisonWindows();

  var cmpVals = null;
  if(cmp.available){
    var salesND = nonDateFilteredSales();
    var returnsND = nonDateFilteredReturns();
    var curSales = rowsInWindowBy(salesND,'date',cmp.curStart,cmp.curEnd);
    var curReturns = rowsInWindowBy(returnsND,'_orderDate',cmp.curStart,cmp.curEnd);
    var prevSales = rowsInWindowBy(salesND,'date',cmp.prevStart,cmp.prevEnd);
    var prevReturns = rowsInWindowBy(returnsND,'_orderDate',cmp.prevStart,cmp.prevEnd);
    var curK = computeKpis(curSales, curReturns);
    var prevK = computeKpis(prevSales, prevReturns);
    cmpVals = {cur:curK, prev:prevK};
  }

  var html = KPI_DEFS.map(function(def){
    var val = kpis[def.key];
    var sparkVals = monthly.map(def.spark);
    var trendHtml = '<span class="kpi-trend flat">No prior period</span><div class="kpi-compare">Full-year 2025 shown</div>';
    if(cmpVals){
      var curV = cmpVals.cur[def.key];
      var prevV = cmpVals.prev[def.key];
      var change = pctChange(curV, prevV);
      if(change===null){
        trendHtml = '<span class="kpi-trend flat">—</span><div class="kpi-compare">'+esc(cmp.label)+'</div>';
      } else {
        var dir = change>0.05?'up':(change<-0.05?'down':'flat');
        var arrow = dir==='up' ? '<path d="M12 19V5M5 12l7-7 7 7"/>' : (dir==='down' ? '<path d="M12 5v14M5 12l7 7 7-7"/>' : '<path d="M5 12h14"/>');
        trendHtml = '<span class="kpi-trend '+dir+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">'+arrow+'</svg>'+(change>=0?'+':'')+change.toFixed(1)+'%</span>'+
          '<div class="kpi-compare">'+esc(cmp.label)+'</div>';
      }
    }
    return '<div class="kpi-card">'+
      '<div class="kpi-label">'+esc(def.label)+'</div>'+
      '<div class="kpi-value">'+def.fmt(val)+'</div>'+
      '<div class="kpi-foot"><div>'+trendHtml+'</div><div class="kpi-spark">'+sparklineSVG(sparkVals,'#7EA2FF')+'</div></div>'+
      '</div>';
  }).join('');

  return '<div class="kpi-row">'+html+'</div>';
}
/* ============ OVERVIEW PAGE ============ */
function renderOverview(){
  var el = document.getElementById('page-overview');
  var sales = getFilteredSales();
  var rev = sales.filter(function(r){return r.rev;});
  var returns = getFilteredReturns();

  var monthly = monthlySeries(rev, function(r){return r.total;});

  var byChannel = groupSum(rev, function(r){return r.channel;}, function(r){return r.total;});
  var channelData = sortedEntries(byChannel).map(function(e,i){return {label:e[0], value:e[1], color:COLORS[i%COLORS.length]};});
  var channelTotal = channelData.reduce(function(a,d){return a+d.value;},0);

  var byCat = groupSum(rev, function(r){return r.cat;}, function(r){return r.total;});
  var catData = sortedEntries(byCat).map(function(e,i){return {label:e[0], value:e[1], color:COLORS[i%COLORS.length]};});
  var catTotal = catData.reduce(function(a,d){return a+d.value;},0);

  /* top products */
  var prodAgg = {};
  rev.forEach(function(r){
    if(!prodAgg[r.sku]) prodAgg[r.sku] = {sku:r.sku, name:r.product, cat:r.cat, revenue:0, orders:0};
    prodAgg[r.sku].revenue += r.total;
    prodAgg[r.sku].orders += 1;
  });
  var topProducts = Object.values(prodAgg).sort(function(a,b){return b.revenue-a.revenue;}).slice(0,5);

  /* revenue by region (country) */
  var byCountry = groupSum(rev, function(r){return r.country;}, function(r){return r.total;});
  var ordersByCountry = groupCount(rev, function(r){return r.country;});
  var countryData = sortedEntries(byCountry).map(function(e){
    return {label:e[0], value:e[1], sub: fmtNum(ordersByCountry[e[0]]||0)+' orders'};
  });

  /* marketing performance (respects date filter only) */
  var mkt = getFilteredMarketing();
  var mktByChannel = {};
  mkt.forEach(function(m){
    if(!mktByChannel[m.channel]) mktByChannel[m.channel] = {spend:0, revenue:0, orders:0};
    mktByChannel[m.channel].spend += (m.spend||0);
    mktByChannel[m.channel].revenue += (m.revenue||0);
    mktByChannel[m.channel].orders += (m.orders||0);
  });
  var mktRows = Object.keys(mktByChannel).map(function(c){
    var d = mktByChannel[c];
    return {channel:c, spend:d.spend, revenue:d.revenue, orders:d.orders, roas: d.spend>0 ? d.revenue/d.spend : null};
  }).sort(function(a,b){return b.revenue-a.revenue;});
  var mktTotals = mktRows.reduce(function(a,r){ a.spend+=r.spend; a.revenue+=r.revenue; a.orders+=r.orders; return a; }, {spend:0, revenue:0, orders:0});
  var mktTotalRoas = mktTotals.spend>0 ? mktTotals.revenue/mktTotals.spend : null;

  /* returns analysis */
  var retKpis = computeKpis(sales, returns);
  var byReason = groupCount(returns, function(r){return r.reason;});
  var reasonData = sortedEntries(byReason).map(function(e){return {label:e[0], value:e[1]};});

  var insights = computeInsights();

  el.innerHTML =
    renderKpiRow() +
    '<div class="grid-2">'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Revenue Over Time<span class="hint">Monthly revenue, valid (non-cancelled) orders</span></div><div class="card-value">'+fmtCurrency(rev.reduce(function(a,r){return a+r.total;},0))+' total</div></div>'+
        '<div id="ov-trend"></div>'+
      '</div>'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Revenue by Channel<span class="hint">Shopify · Amazon · Retail Partner</span></div></div>'+
        '<div style="display:flex; align-items:center; gap:18px; flex-wrap:wrap;">'+
          '<div id="ov-channel-donut"></div>'+
          '<div class="legend" style="flex:1; min-width:140px;">'+legendHTML(channelData, channelTotal)+'</div>'+
        '</div>'+
      '</div>'+
    '</div>'+
    '<div class="grid-3">'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Revenue by Category<span class="hint">6 product categories</span></div></div>'+
        '<div style="display:flex; flex-direction:column; align-items:center; gap:10px;">'+
          '<div id="ov-cat-donut"></div>'+
          '<div class="legend" style="width:100%;">'+legendHTML(catData, catTotal)+'</div>'+
        '</div>'+
      '</div>'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Top Products by Revenue<span class="hint">Top 5, current filters</span></div></div>'+
        '<div class="table-scroll"><table><thead><tr><th>Product</th><th class="num">Revenue</th><th class="num">Orders</th><th class="num">AOV</th></tr></thead><tbody>'+
        (topProducts.length ? topProducts.map(function(p){
          return '<tr><td><div class="prod-name">'+esc(p.name)+'</div><div class="prod-sub">'+esc(p.cat)+' · '+esc(p.sku)+'</div></td>'+
            '<td class="num">'+fmtCurrency(p.revenue)+'</td><td class="num">'+fmtNum(p.orders)+'</td><td class="num">'+fmtCurrency(p.revenue/p.orders,2)+'</td></tr>';
        }).join('') : '<tr><td colspan="4"><div class="empty-state">No orders match the current filters.</div></td></tr>')+
        '</tbody></table></div>'+
      '</div>'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Revenue by Region<span class="hint">By market</span></div></div>'+
        (countryData.length ? barListHTML(countryData) : '<div class="empty-state">No data for current filters.</div>')+
      '</div>'+
    '</div>'+
    '<div class="grid-2b">'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Marketing Performance<span class="hint">By ad channel · filtered by date range only</span></div></div>'+
        '<div class="table-scroll"><table><thead><tr><th>Channel</th><th class="num">Spend</th><th class="num">Revenue</th><th class="num">ROAS</th><th class="num">Orders</th></tr></thead><tbody>'+
        (mktRows.length ? mktRows.map(function(m){
          return '<tr><td>'+esc(m.channel)+'</td><td class="num">'+fmtCurrency(m.spend)+'</td><td class="num">'+fmtCurrency(m.revenue)+'</td>'+
            '<td class="num">'+(m.roas!==null? m.roas.toFixed(2)+'x' : '<span style="color:var(--text3)">n/a</span>')+'</td><td class="num">'+fmtNum(m.orders)+'</td></tr>';
        }).join('') : '<tr><td colspan="5"><div class="empty-state">No marketing data in this date range.</div></td></tr>')+
        (mktRows.length ? '</tbody><tfoot><tr><td>Total</td><td class="num">'+fmtCurrency(mktTotals.spend)+'</td><td class="num">'+fmtCurrency(mktTotals.revenue)+'</td>'+
          '<td class="num">'+(mktTotalRoas!==null?mktTotalRoas.toFixed(2)+'x':'n/a')+'</td><td class="num">'+fmtNum(mktTotals.orders)+'</td></tr></tfoot>' : '</tbody>')+
        '</table></div>'+
      '</div>'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Returns Analysis<span class="hint">Current filters</span></div></div>'+
        '<div style="display:flex; gap:18px; margin-bottom:13px;">'+
          '<div><div class="kpi-label">Total Returns</div><div style="font-size:19px;font-weight:800;margin-top:4px;">'+fmtNum(retKpis.returnCount)+'</div></div>'+
          '<div><div class="kpi-label">Return Revenue</div><div style="font-size:19px;font-weight:800;margin-top:4px;">'+fmtCurrency(retKpis.returnRevenue)+'</div></div>'+
          '<div><div class="kpi-label">Return Rate</div><div style="font-size:19px;font-weight:800;margin-top:4px;">'+fmtPct(retKpis.returnRate)+'</div></div>'+
        '</div>'+
        '<div class="card-title" style="margin-bottom:8px; font-size:11.5px; color:var(--text2); text-transform:uppercase; letter-spacing:0.5px;">Top return reasons</div>'+
        (reasonData.length ? barListHTML(reasonData, {fmt:function(v){return fmtNum(v)+' returns';}}) : '<div class="empty-state">No returns in this selection.</div>')+
      '</div>'+
    '</div>'+
    '<div class="insights">'+
      '<div class="section-head" style="margin-bottom:0;"><h2>Recent Insights</h2><div class="meta">Derived from validated full-year 2025 data</div></div>'+
      '<div class="insight-list">'+insights.map(function(ins){
        return '<div class="insight-item"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'+INSIGHT_ICONS[ins.icon]+'</svg></span><span>'+ins.html+'</span></div>';
      }).join('')+'</div>'+
    '</div>';

  areaChart(document.getElementById('ov-trend'), monthly.labels, monthly.values, {height:isMobileWidth()?170:230});
  donutChart(document.getElementById('ov-channel-donut'), channelData, {centerLabel:'Revenue', centerValue: fmtCurrencyCompact(channelTotal)});
  donutChart(document.getElementById('ov-cat-donut'), catData, {centerLabel:'Revenue', centerValue: fmtCurrencyCompact(catTotal)});
}
/* ============ SALES PAGE ============ */
function miniKpi(label, value){
  return '<div class="kpi-card" style="padding:14px 16px;"><div class="kpi-label">'+esc(label)+'</div><div class="kpi-value" style="font-size:20px;">'+value+'</div></div>';
}

function renderSales(){
  var el = document.getElementById('page-sales');
  var sales = getFilteredSales();
  var rev = sales.filter(function(r){return r.rev;});
  var monthly = monthlySeries(rev, function(r){return r.total;});
  var k = computeKpis(sales, getFilteredReturns());

  var byChannel = groupSum(rev, function(r){return r.channel;}, function(r){return r.total;});
  var channelData = sortedEntries(byChannel).map(function(e){return {label:e[0], value:e[1]};});

  var byCountry = groupSum(rev, function(r){return r.country;}, function(r){return r.total;});
  var countryData = sortedEntries(byCountry).map(function(e){return {label:e[0], value:e[1]};});

  var byStatus = groupCount(sales, function(r){return r.status;});
  var statusData = sortedEntries(byStatus).map(function(e){return {label:e[0], value:e[1]};});

  var byCat = groupSum(rev, function(r){return r.cat;}, function(r){return r.total;});
  var catData = sortedEntries(byCat).map(function(e){return {label:e[0], value:e[1]};});

  el.innerHTML =
    '<div class="kpi-row" style="grid-template-columns:repeat(4,1fr); margin-bottom:20px;">'+
      miniKpi('Total Revenue', fmtCurrency(k.revenue))+
      miniKpi('Total Orders', fmtNum(k.orders))+
      miniKpi('Units Sold', fmtNum(k.units))+
      miniKpi('Average Order Value', fmtCurrency(k.aov,2))+
    '</div>'+
    '<div class="card" style="margin-bottom:16px;">'+
      '<div class="card-head"><div class="card-title">Monthly Revenue Trend<span class="hint">Which months performed best</span></div></div>'+
      '<div id="sl-trend"></div>'+
    '</div>'+
    '<div class="grid-3">'+
      '<div class="card"><div class="card-head"><div class="card-title">Revenue by Channel</div></div>'+(channelData.length?barListHTML(channelData):'<div class="empty-state">No data.</div>')+'</div>'+
      '<div class="card"><div class="card-head"><div class="card-title">Revenue by Region</div></div>'+(countryData.length?barListHTML(countryData):'<div class="empty-state">No data.</div>')+'</div>'+
      '<div class="card"><div class="card-head"><div class="card-title">Revenue by Category</div></div>'+(catData.length?barListHTML(catData):'<div class="empty-state">No data.</div>')+'</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-head"><div class="card-title">Order Status Breakdown<span class="hint">All orders incl. cancelled — order count</span></div></div>'+
      (statusData.length?barListHTML(statusData, {fmt:function(v){return fmtNum(v)+' orders';}}):'<div class="empty-state">No data.</div>')+
    '</div>';

  areaChart(document.getElementById('sl-trend'), monthly.labels, monthly.values, {height:isMobileWidth()?180:260});
}

/* ============ PRODUCTS PAGE ============ */
var productSortKey = 'revenue';
var productSearch = '';
var productPage = 0;
var PRODUCT_PAGE_SIZE = 12;

function renderProducts(){
  var el = document.getElementById('page-products');
  var sales = getFilteredSales();
  var rev = sales.filter(function(r){return r.rev;});
  var returns = getFilteredReturns();
  var returnsBySku = groupCount(returns, function(r){return r.sku;});

  var agg = {};
  rev.forEach(function(r){
    if(!agg[r.sku]) agg[r.sku] = {sku:r.sku, name:r.product, cat:r.cat, revenue:0, orders:0, units:0, cost:0};
    var a = agg[r.sku];
    a.revenue += r.total; a.orders += 1; a.units += r.qty; a.cost += r.cost;
  });
  var rows = Object.values(agg).map(function(a){
    var margin = a.revenue>0 ? (a.revenue-a.cost)/a.revenue*100 : null;
    var retCount = returnsBySku[a.sku]||0;
    var retRate = a.orders>0 ? retCount/a.orders*100 : null;
    return Object.assign(a, {margin:margin, returnRate:retRate, returnCount:retCount});
  });

  var sortFns = {
    revenue: function(a,b){return b.revenue-a.revenue;},
    margin: function(a,b){return (b.margin||-999)-(a.margin||-999);},
    orders: function(a,b){return b.orders-a.orders;},
    returnRate: function(a,b){return (b.returnRate||-1)-(a.returnRate||-1);}
  };
  rows.sort(sortFns[productSortKey]);

  var term = productSearch.trim().toLowerCase();
  var filteredRows = term ? rows.filter(function(p){
    return p.name.toLowerCase().indexOf(term)>=0 || p.sku.toLowerCase().indexOf(term)>=0 || p.cat.toLowerCase().indexOf(term)>=0;
  }) : rows;

  var totalPages = Math.max(1, Math.ceil(filteredRows.length/PRODUCT_PAGE_SIZE));
  if(productPage >= totalPages) productPage = totalPages-1;
  if(productPage < 0) productPage = 0;
  var pageStart = productPage*PRODUCT_PAGE_SIZE;
  var pageRows = filteredRows.slice(pageStart, pageStart+PRODUCT_PAGE_SIZE);

  var activeCount = RAW.products.filter(function(p){return p.status==='Active';}).length;
  var totalUnits = rev.reduce(function(a,r){return a+r.qty;},0);
  var skusSold = Object.keys(agg).length;
  var overallMargin = rev.length ? (rev.reduce(function(a,r){return a+r.total-r.cost;},0)/rev.reduce(function(a,r){return a+r.total;},0)*100) : null;

  el.innerHTML =
    '<div class="kpi-row" style="grid-template-columns:repeat(4,1fr); margin-bottom:20px;">'+
      miniKpi('Active Products', fmtNum(activeCount)+' / '+RAW.products.length)+
      miniKpi('SKUs Sold (filtered)', fmtNum(skusSold))+
      miniKpi('Units Sold', fmtNum(totalUnits))+
      miniKpi('Overall Gross Margin', fmtPct(overallMargin))+
    '</div>'+
    '<div class="card">'+
      '<div class="card-head">'+
        '<div class="card-title">Product Performance<span class="hint">'+filteredRows.length+' of '+rows.length+' products with sales in current filters</span></div>'+
      '</div>'+
      '<div class="table-toolbar">'+
        '<div class="search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>'+
        '<input type="text" class="search-input" id="productSearch" placeholder="Search product, SKU, or category" value="'+esc(productSearch)+'"></div>'+
        '<select id="productSort"><option value="revenue">Sort: Revenue</option><option value="orders">Sort: Orders</option><option value="margin">Sort: Margin</option><option value="returnRate">Sort: Return rate</option></select>'+
      '</div>'+
      '<div class="table-scroll"><table><thead><tr><th>Product</th><th class="num">Orders</th><th class="num">Units</th><th class="num">Revenue</th><th class="num">Margin</th><th class="num">Return Rate</th></tr></thead><tbody>'+
      (pageRows.length ? pageRows.map(function(p){
        var marginPill = p.margin===null ? '<span class="pill neutral">n/a</span>' : '<span class="pill '+(p.margin>=40?'good':(p.margin<20?'warn':'neutral'))+'">'+fmtPct(p.margin)+'</span>';
        var retPill = p.returnRate===null ? 'n/a' : (p.returnRate>15 ? '<span class="pill warn">'+fmtPct(p.returnRate)+'</span>' : fmtPct(p.returnRate));
        return '<tr><td><div class="prod-name">'+esc(p.name)+'</div><div class="prod-sub">'+esc(p.cat)+' · '+esc(p.sku)+'</div></td>'+
          '<td class="num">'+fmtNum(p.orders)+'</td><td class="num">'+fmtNum(p.units)+'</td><td class="num">'+fmtCurrency(p.revenue)+'</td>'+
          '<td class="num">'+marginPill+'</td><td class="num">'+retPill+'</td></tr>';
      }).join('') : '<tr><td colspan="6"><div class="empty-state">No products match'+(term?' "'+esc(productSearch)+'"':' the current filters')+'.</div></td></tr>')+
      '</tbody></table></div>'+
      (filteredRows.length ? '<div class="pagination">'+
        '<span class="page-info">Showing '+(pageStart+1)+'–'+Math.min(pageStart+PRODUCT_PAGE_SIZE, filteredRows.length)+' of '+filteredRows.length+'</span>'+
        '<button class="page-btn" id="prodPrev" '+(productPage===0?'disabled':'')+' aria-label="Previous page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 18l-6-6 6-6"/></svg></button>'+
        '<span class="page-info">Page '+(productPage+1)+' of '+totalPages+'</span>'+
        '<button class="page-btn" id="prodNext" '+(productPage>=totalPages-1?'disabled':'')+' aria-label="Next page"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18l6-6-6-6"/></svg></button>'+
      '</div>' : '')+
    '</div>';

  var sortSel = document.getElementById('productSort');
  if(sortSel){ sortSel.value = productSortKey; sortSel.addEventListener('change', function(){ productSortKey = sortSel.value; productPage = 0; renderProducts(); }); }
  var searchInput = document.getElementById('productSearch');
  if(searchInput){
    searchInput.addEventListener('input', debounce(function(e){ productSearch = e.target.value; productPage = 0; renderProducts(); document.getElementById('productSearch').focus(); }, 250));
  }
  var prevBtn = document.getElementById('prodPrev');
  var nextBtn = document.getElementById('prodNext');
  if(prevBtn) prevBtn.addEventListener('click', function(){ productPage--; renderProducts(); });
  if(nextBtn) nextBtn.addEventListener('click', function(){ productPage++; renderProducts(); });
}

/* ============ CUSTOMERS PAGE ============ */
function renderCustomers(){
  var el = document.getElementById('page-customers');
  var sales = getFilteredSales();
  var rev = sales.filter(function(r){return r.rev;});

  var ordersByCust = {};
  rev.forEach(function(r){
    if(!r.cust) return;
    if(!ordersByCust[r.cust]) ordersByCust[r.cust] = {orders:0, revenue:0};
    ordersByCust[r.cust].orders += 1;
    ordersByCust[r.cust].revenue += r.total;
  });
  var custIds = Object.keys(ordersByCust);
  var purchased = custIds.length;
  var newCust = custIds.filter(function(c){return ordersByCust[c].orders===1;}).length;
  var returningCust = custIds.filter(function(c){return ordersByCust[c].orders>=2;}).length;
  var avgOrders = purchased>0 ? custIds.reduce(function(a,c){return a+ordersByCust[c].orders;},0)/purchased : null;

  var custMeta = {};
  RAW.customers.forEach(function(c){ custMeta[c.id]=c; });

  var segCounts = {};
  var acqCounts = {};
  custIds.forEach(function(cid){
    var m = custMeta[cid];
    if(!m) return;
    segCounts[m.segment] = (segCounts[m.segment]||0)+1;
    acqCounts[m.acq] = (acqCounts[m.acq]||0)+1;
  });
  var segData = sortedEntries(segCounts).map(function(e){return {label:e[0], value:e[1]};});
  var acqData = sortedEntries(acqCounts).map(function(e){return {label:e[0], value:e[1]};});

  var topCust = custIds.map(function(cid){
    var m = custMeta[cid] || {};
    return {id:cid, orders:ordersByCust[cid].orders, revenue:ordersByCust[cid].revenue, country:m.country, segment:m.segment, ltv:m.ltv};
  }).sort(function(a,b){return b.revenue-a.revenue;}).slice(0,10);

  el.innerHTML =
    '<div class="kpi-row" style="grid-template-columns:repeat(4,1fr); margin-bottom:20px;">'+
      miniKpi('Customers Who Purchased', fmtNum(purchased))+
      miniKpi('New (1 order, filtered period)', fmtNum(newCust))+
      miniKpi('Returning (2+ orders)', fmtNum(returningCust))+
      miniKpi('Avg. Orders / Customer', avgOrders!==null ? avgOrders.toFixed(2) : '—')+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card"><div class="card-head"><div class="card-title">Customer Segment<span class="hint">Ops-assigned segment (Customers master)</span></div></div>'+(segData.length?barListHTML(segData,{fmt:function(v){return fmtNum(v);}}):'<div class="empty-state">No data.</div>')+'</div>'+
      '<div class="card"><div class="card-head"><div class="card-title">Acquisition Source</div></div>'+(acqData.length?barListHTML(acqData,{fmt:function(v){return fmtNum(v);}, columns: acqData.length>5?2:1}):'<div class="empty-state">No data.</div>')+'</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-head"><div class="card-title">Top Customers by Revenue<span class="hint">Lifetime Value is updated quarterly by ops — not real-time</span></div></div>'+
      '<div class="table-scroll"><table><thead><tr><th>Customer ID</th><th>Country</th><th>Segment</th><th class="num">Orders</th><th class="num">Revenue (period)</th><th class="num">Lifetime Value</th></tr></thead><tbody>'+
      (topCust.length ? topCust.map(function(c){
        return '<tr><td>'+esc(c.id)+'</td><td>'+esc(c.country||'—')+'</td><td>'+esc(c.segment||'—')+'</td>'+
          '<td class="num">'+fmtNum(c.orders)+'</td><td class="num">'+fmtCurrency(c.revenue)+'</td><td class="num">'+(c.ltv!==undefined&&c.ltv!==null?fmtCurrency(c.ltv):'—')+'</td></tr>';
      }).join('') : '<tr><td colspan="6"><div class="empty-state">No customers match the current filters.</div></td></tr>')+
      '</tbody></table></div>'+
    '</div>';
}

/* ============ MARKETING PAGE ============ */
function renderMarketing(){
  var el = document.getElementById('page-marketing');
  var mkt = getFilteredMarketing();
  var totalSpend = mkt.reduce(function(a,m){return a+(m.spend||0);},0);
  var totalRevenue = mkt.reduce(function(a,m){return a+(m.revenue||0);},0);
  var totalOrders = mkt.reduce(function(a,m){return a+(m.orders||0);},0);
  var blendedRoas = totalSpend>0 ? totalRevenue/totalSpend : null;

  var weekly = {};
  mkt.forEach(function(m){ weekly[m.date] = (weekly[m.date]||0) + (m.revenue||0); });
  var weekKeys = Object.keys(weekly).sort();
  var weekLabels = weekKeys.map(function(k){ var d=new Date(k+'T00:00:00'); return (d.getMonth()+1)+'/'+d.getDate(); });
  var weekVals = weekKeys.map(function(k){return weekly[k];});

  var byChannel = {};
  mkt.forEach(function(m){
    if(!byChannel[m.channel]) byChannel[m.channel] = {spend:0, revenue:0, orders:0};
    byChannel[m.channel].spend += (m.spend||0);
    byChannel[m.channel].revenue += (m.revenue||0);
    byChannel[m.channel].orders += (m.orders||0);
  });
  var channelRows = Object.keys(byChannel).map(function(c){
    var d = byChannel[c];
    return {channel:c, spend:d.spend, revenue:d.revenue, orders:d.orders, roas: d.spend>0? d.revenue/d.spend : null};
  }).sort(function(a,b){return b.revenue-a.revenue;});

  var byCampaign = {};
  mkt.forEach(function(m){
    var k = m.campaign+'||'+m.channel;
    if(!byCampaign[k]) byCampaign[k] = {campaign:m.campaign, channel:m.channel, spend:0, revenue:0, orders:0};
    byCampaign[k].spend += (m.spend||0);
    byCampaign[k].revenue += (m.revenue||0);
    byCampaign[k].orders += (m.orders||0);
  });
  var campRows = Object.values(byCampaign).sort(function(a,b){return b.revenue-a.revenue;});
  var channelTotals = channelRows.reduce(function(a,r){ a.spend+=r.spend; a.revenue+=r.revenue; a.orders+=r.orders; return a; }, {spend:0, revenue:0, orders:0});
  var channelTotalRoas = channelTotals.spend>0 ? channelTotals.revenue/channelTotals.spend : null;
  var CAMPAIGN_ROWS = Math.max(channelRows.length+1, 6);

  el.innerHTML =
    '<div class="kpi-row" style="grid-template-columns:repeat(4,1fr); margin-bottom:20px;">'+
      miniKpi('Marketing Spend', fmtCurrency(totalSpend))+
      miniKpi('Attributed Revenue', fmtCurrency(totalRevenue))+
      miniKpi('Blended ROAS', blendedRoas!==null ? blendedRoas.toFixed(2)+'x' : '—')+
      miniKpi('Attributed Orders', fmtNum(totalOrders))+
    '</div>'+
    '<div class="card" style="margin-bottom:16px;">'+
      '<div class="card-head"><div class="card-title">Attributed Revenue by Week<span class="hint">Ad-platform channels · filtered by date range only</span></div></div>'+
      '<div id="mk-trend"></div>'+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Performance by Channel</div></div>'+
        '<div class="table-scroll"><table><thead><tr><th>Channel</th><th class="num">Spend</th><th class="num">Revenue</th><th class="num">ROAS</th></tr></thead><tbody>'+
        channelRows.map(function(c){
          return '<tr><td>'+esc(c.channel)+'</td><td class="num">'+fmtCurrency(c.spend)+'</td><td class="num">'+fmtCurrency(c.revenue)+'</td>'+
            '<td class="num">'+(c.roas!==null?c.roas.toFixed(2)+'x':'<span style="color:var(--text3)">n/a</span>')+'</td></tr>';
        }).join('')+
        (channelRows.length ? '</tbody><tfoot><tr><td>Total</td><td class="num">'+fmtCurrency(channelTotals.spend)+'</td><td class="num">'+fmtCurrency(channelTotals.revenue)+'</td>'+
          '<td class="num">'+(channelTotalRoas!==null?channelTotalRoas.toFixed(2)+'x':'n/a')+'</td></tr></tfoot>' : '</tbody>')+
        '</table></div>'+
      '</div>'+
      '<div class="card">'+
        '<div class="card-head"><div class="card-title">Top Campaigns by Revenue<span class="hint">Top '+CAMPAIGN_ROWS+'</span></div></div>'+
        '<div class="table-scroll"><table><thead><tr><th>Campaign</th><th class="num">Spend</th><th class="num">Revenue</th><th class="num">ROAS</th></tr></thead><tbody>'+
        campRows.slice(0,CAMPAIGN_ROWS).map(function(c){
          var roas = c.spend>0 ? c.revenue/c.spend : null;
          return '<tr><td><div class="prod-name">'+esc(c.campaign)+'</div><div class="prod-sub">'+esc(c.channel)+'</div></td><td class="num">'+fmtCurrency(c.spend)+'</td><td class="num">'+fmtCurrency(c.revenue)+'</td>'+
            '<td class="num">'+(roas!==null?roas.toFixed(2)+'x':'<span style="color:var(--text3)">n/a</span>')+'</td></tr>';
        }).join('')+
        '</tbody></table></div>'+
      '</div>'+
    '</div>';

  if(weekVals.length){ areaChart(document.getElementById('mk-trend'), weekLabels, weekVals, {height:isMobileWidth()?160:200}); }
  else { document.getElementById('mk-trend').innerHTML = '<div class="empty-state">No marketing data in this date range.</div>'; }
}

/* ============ RETURNS PAGE ============ */
function renderReturns(){
  var el = document.getElementById('page-returns');
  var sales = getFilteredSales();
  var returns = getFilteredReturns();
  var k = computeKpis(sales, returns);
  var avgRefund = returns.length ? returns.reduce(function(a,r){return a+r.refund;},0)/returns.length : null;

  var byReason = groupCount(returns, function(r){return r.reason;});
  var reasonData = sortedEntries(byReason).map(function(e){return {label:e[0], value:e[1]};});

  var byCat = groupCount(returns, function(r){return r._cat;});
  var catData = sortedEntries(byCat).map(function(e){return {label:e[0], value:e[1]};});

  var revRows = sales.filter(function(r){return r.rev;});
  var ordersBySku = groupCount(revRows, function(r){return r.sku;});
  var returnsBySku = groupCount(returns, function(r){return r.sku;});
  var prodReturns = Object.keys(returnsBySku).map(function(sku){
    var orders = ordersBySku[sku]||0;
    var name = productBySku[sku] ? productBySku[sku].name : sku;
    return {sku:sku, name:name, returns:returnsBySku[sku], orders:orders, rate: orders>0? returnsBySku[sku]/orders*100 : null};
  }).sort(function(a,b){return b.returns-a.returns;}).slice(0,10);

  el.innerHTML =
    '<div class="kpi-row" style="grid-template-columns:repeat(4,1fr); margin-bottom:20px;">'+
      miniKpi('Total Returns', fmtNum(k.returnCount))+
      miniKpi('Return Revenue', fmtCurrency(k.returnRevenue))+
      miniKpi('Return Rate', fmtPct(k.returnRate))+
      miniKpi('Avg. Refund', avgRefund!==null?fmtCurrency(avgRefund,2):'—')+
    '</div>'+
    '<div class="grid-2">'+
      '<div class="card"><div class="card-head"><div class="card-title">Return Reasons</div></div>'+(reasonData.length?barListHTML(reasonData,{fmt:function(v){return fmtNum(v)+' returns';}}):'<div class="empty-state">No returns.</div>')+'</div>'+
      '<div class="card"><div class="card-head"><div class="card-title">Returns by Category</div></div>'+(catData.length?barListHTML(catData,{fmt:function(v){return fmtNum(v)+' returns';}}):'<div class="empty-state">No returns.</div>')+'</div>'+
    '</div>'+
    '<div class="card">'+
      '<div class="card-head"><div class="card-title">Most-Returned Products<span class="hint">Return rate = returns / orders for that SKU, current filters</span></div></div>'+
      '<div class="table-scroll"><table><thead><tr><th>Product</th><th class="num">Returns</th><th class="num">Orders</th><th class="num">Return Rate</th></tr></thead><tbody>'+
      (prodReturns.length ? prodReturns.map(function(p){
        var pill = p.rate===null?'n/a':(p.rate>15?'<span class="pill warn">'+fmtPct(p.rate)+'</span>':fmtPct(p.rate));
        return '<tr><td><div class="prod-name">'+esc(p.name)+'</div><div class="prod-sub">'+esc(p.sku)+'</div></td><td class="num">'+fmtNum(p.returns)+'</td><td class="num">'+fmtNum(p.orders)+'</td><td class="num">'+pill+'</td></tr>';
      }).join('') : '<tr><td colspan="4"><div class="empty-state">No returns match the current filters.</div></td></tr>')+
      '</tbody></table></div>'+
    '</div>';
}
/* ============ NAV CONFIG ============ */
const PAGES = [
  {id:'overview', label:'Overview', title:'Overview', sub:'Executive dashboard summary of Northstar Home performance', icon:'<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>', render:renderOverview},
  {id:'sales', label:'Sales', title:'Sales', sub:'Revenue performance by month, channel, region and category', icon:'<path d="M3 3v18h18"/><path d="M18 17l-5-6-4 4-4-5"/>', render:renderSales},
  {id:'products', label:'Products', title:'Products', sub:'Product-level revenue, margin and return performance', icon:'<path d="M20 7L12 3 4 7m16 0l-8 4m8-4v10l-8 4M4 7l8 4m-8-4v10l8 4m0-10v10"/>', render:renderProducts},
  {id:'customers', label:'Customers', title:'Customers', sub:'Who is buying, how often, and where they come from', icon:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15.5 13.2a5.2 5.2 0 016.5 5"/>', render:renderCustomers},
  {id:'marketing', label:'Marketing', title:'Marketing', sub:'Spend, attributed revenue and ROAS by channel and campaign', icon:'<path d="M3 11l18-7-7 18-3-8-8-3z"/>', render:renderMarketing},
  {id:'returns', label:'Returns', title:'Returns', sub:'Return volume, reasons and product-level return rates', icon:'<path d="M3 12a9 9 0 109-9"/><path d="M3 3v6h6"/>', render:renderReturns}
];

function renderNav(){
  var navList = document.getElementById('navList');
  navList.innerHTML = PAGES.map(function(p){
    return '<button class="nav-item'+(p.id===state.page?' active':'')+'" data-page="'+p.id+'">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">'+p.icon+'</svg>'+
      '<span>'+p.label+'</span></button>';
  }).join('');
  navList.querySelectorAll('.nav-item').forEach(function(btn){
    btn.addEventListener('click', function(){
      state.page = btn.getAttribute('data-page');
      renderAll();
      document.getElementById('rail').classList.remove('open');
      document.getElementById('railScrim').classList.remove('show');
      window.scrollTo({top:0, behavior:'smooth'});
    });
  });
}

function renderAll(){
  renderNav();
  var active = PAGES.find(function(p){return p.id===state.page;});
  document.getElementById('pageTitle').textContent = active.title;
  document.getElementById('pageSub').textContent = active.sub;
  document.querySelectorAll('.page').forEach(function(pg){ pg.classList.remove('active'); });
  document.getElementById('page-'+active.id).classList.add('active');
  active.render();
  document.getElementById('footRange').textContent = 'Showing '+fmtDate(state.start)+' – '+fmtDate(state.end)+
    (state.country!=='All' ? ' · '+state.country : '') + (state.channel!=='All' ? ' · '+state.channel : '') + (state.category!=='All' ? ' · '+state.category : '');
}

/* ============ FILTERS ============ */
function populateFilterSelectOptions(){
  function fill(sel, values, allLabel){
    var current = sel.value;
    sel.innerHTML = '<option value="All">'+allLabel+'</option>'+values.map(function(v){return '<option value="'+esc(v)+'">'+esc(v)+'</option>';}).join('');
    if(values.indexOf(current)>=0) sel.value = current;
  }
  fill(document.getElementById('fCountry'), COUNTRIES, 'All Countries');
  fill(document.getElementById('fChannel'), CHANNELS, 'All Channels');
  fill(document.getElementById('fCategory'), CATS, 'All Categories');
}
function populateFilterSelects(){
  populateFilterSelectOptions();
  document.getElementById('dateStart').value = state.start;
  document.getElementById('dateStart').min = PERIOD_START;
  document.getElementById('dateStart').max = PERIOD_END;
  document.getElementById('dateEnd').value = state.end;
  document.getElementById('dateEnd').min = PERIOD_START;
  document.getElementById('dateEnd').max = PERIOD_END;
}

function wireFilters(){
  document.getElementById('dateStart').addEventListener('change', function(e){
    var v = e.target.value || PERIOD_START;
    if(v > state.end) v = state.end;
    state.start = v; productPage = 0; renderAll();
  });
  document.getElementById('dateEnd').addEventListener('change', function(e){
    var v = e.target.value || PERIOD_END;
    if(v < state.start) v = state.start;
    state.end = v; productPage = 0; renderAll();
  });
  document.getElementById('fCountry').addEventListener('change', function(e){ state.country = e.target.value; productPage = 0; renderAll(); });
  document.getElementById('fChannel').addEventListener('change', function(e){ state.channel = e.target.value; productPage = 0; renderAll(); });
  document.getElementById('fCategory').addEventListener('change', function(e){ state.category = e.target.value; productPage = 0; renderAll(); });
  document.getElementById('resetBtn').addEventListener('click', function(){
    state.start = PERIOD_START; state.end = PERIOD_END;
    state.country = 'All'; state.channel = 'All'; state.category = 'All';
    productPage = 0; productSearch = ''; productSortKey = 'revenue';
    populateFilterSelects();
    renderAll();
  });
}

/* ============ TOP ACTIONS ============ */
function wireActions(){
  document.getElementById('exportBtn').addEventListener('click', function(){ window.print(); });
  document.getElementById('shareBtn').addEventListener('click', function(){
    var summary = 'Northstar Home — '+PAGES.find(function(p){return p.id===state.page;}).title+' · '+fmtDate(state.start)+' to '+fmtDate(state.end);
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(summary).then(function(){
        var btn = document.getElementById('shareBtn');
        var orig = btn.innerHTML;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg><span>Copied</span>';
        setTimeout(function(){ btn.innerHTML = orig; }, 1600);
      }).catch(function(){});
    }
  });
  document.getElementById('notifBtn').addEventListener('click', function(){
    alert('Data-quality notice:\n\n126 orders (2.4%) have a Total Amount that does not fully reconcile to Qty × Price − Discount + Shipping + Tax.\n52 orders show cost exceeding gross revenue on that line.\n2 marketing rows have an invalid negative conversion rate.\n\nAll are flagged, not corrected, in the underlying cleaned dataset. See the Data Audit report for full detail.');
  });
  var menuBtn = document.getElementById('menuBtn');
  var rail = document.getElementById('rail');
  var scrim = document.getElementById('railScrim');
  menuBtn.addEventListener('click', function(){ rail.classList.add('open'); scrim.classList.add('show'); });
  scrim.addEventListener('click', function(){ rail.classList.remove('open'); scrim.classList.remove('show'); });
}

/* ============ LOAD / ERROR / LIVE STATE ============ */
function showLoadingState(){
  document.getElementById('loadState').classList.remove('js-hidden');
  document.getElementById('errorState').classList.add('js-hidden');
  document.getElementById('filterBar').classList.add('js-hidden');
  document.querySelectorAll('.page').forEach(function(p){ p.classList.add('js-hidden'); });
  document.querySelector('footer.dash-foot').classList.add('js-hidden');
  document.getElementById('statusDot').className = 'status-dot';
  document.getElementById('statusText').textContent = 'Connecting to Google Sheets…';
}
function hideLoadingState(){
  document.getElementById('loadState').classList.add('js-hidden');
  document.getElementById('errorState').classList.add('js-hidden');
  document.getElementById('filterBar').classList.remove('js-hidden');
  document.querySelectorAll('.page').forEach(function(p){ p.classList.remove('js-hidden'); });
  document.querySelector('footer.dash-foot').classList.remove('js-hidden');
}
function showErrorState(err){
  document.getElementById('loadState').classList.add('js-hidden');
  document.getElementById('errorState').classList.remove('js-hidden');
  document.getElementById('errorDetail').textContent = (err && err.message) ? err.message : 'A network or permissions error occurred while contacting Google Sheets.';
  document.getElementById('statusDot').className = 'status-dot error';
  document.getElementById('statusText').textContent = 'Connection failed';
}
function markLive(){
  document.getElementById('statusDot').className = 'status-dot live';
  var now = new Date();
  var label = now.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' ' + now.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  document.getElementById('statusText').textContent = 'Data source: Google Sheets · Last refreshed ' + label;
}

/* ============ REFRESH DATA ============ */
async function refreshData(){
  var btn = document.getElementById('refreshBtn');
  if(btn.disabled) return;
  btn.classList.add('refreshing');
  btn.disabled = true;
  try {
    var fresh = await fetchNorthstarData();
    RAW = fresh;
    buildDerivedData();
    /* repopulate filter option lists (values may have changed in the sheet) while
       preserving the user's current selection where it's still valid */
    var keepCountry = state.country, keepChannel = state.channel, keepCategory = state.category;
    populateFilterSelectOptions();
    state.country = COUNTRIES.indexOf(keepCountry)>=0 ? keepCountry : 'All';
    state.channel = CHANNELS.indexOf(keepChannel)>=0 ? keepChannel : 'All';
    state.category = CATS.indexOf(keepCategory)>=0 ? keepCategory : 'All';
    document.getElementById('fCountry').value = state.country;
    document.getElementById('fChannel').value = state.channel;
    document.getElementById('fCategory').value = state.category;
    productPage = 0;
    renderAll();
    markLive();
  } catch(err){
    alert('Refresh failed: ' + (err && err.message ? err.message : 'a network error occurred') + '\n\nStill showing the last successfully loaded data.');
  } finally {
    btn.classList.remove('refreshing');
    btn.disabled = false;
  }
}
function wireRefreshButton(){
  document.getElementById('refreshBtn').addEventListener('click', refreshData);
  document.getElementById('retryBtn').addEventListener('click', boot);
}

/* ============ BOOTSTRAP ============ */
async function boot(){
  showLoadingState();
  try {
    RAW = await fetchNorthstarData();
    buildDerivedData();
    init();
    hideLoadingState();
    markLive();
  } catch(err){
    showErrorState(err);
  }
}
function init(){
  populateFilterSelects();
  wireFilters();
  wireActions();
  renderAll();
  window.addEventListener('resize', debounce(function(){ renderAll(); }, 200));
}
function debounce(fn, ms){
  var t;
  return function(){
    clearTimeout(t);
    var args = arguments;
    t = setTimeout(function(){ fn.apply(null, args); }, ms);
  };
}
wireRefreshButton();
boot();

