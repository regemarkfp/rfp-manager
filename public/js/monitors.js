'use strict';
(function () {
  var key = new URLSearchParams(location.search).get('key'), q = key ? '?key=' + encodeURIComponent(key) : '';
  var list = [['Commentary confidence monitor', 'Score, clock, batters and bowlers or scorers, cards, team stats and talking points for the commentary box.', '/live/comms.html' + q],
    ['Rundown monitor', 'Running order for production: item on air, time left, what is next, ahead or behind schedule.', '/live/rundown.html' + q],
    ['Program output', 'Everything on air, rendered in the browser.', '/live/output.html' + (q ? q + '&' : '?') + 'bg=checker&hud=1'],
    ['Preview output', 'The preview channel with tally and safe areas.', '/live/preview.html' + q]];
  var box = document.getElementById('links');
  list.forEach(function (x) { var a = document.createElement('a'); a.className = 'c'; a.href = x[2]; var b = document.createElement('b'); b.textContent = x[0]; var s = document.createElement('span'); s.textContent = x[1]; a.appendChild(b); a.appendChild(s); box.appendChild(a); });
})();
