// The next leagues' launch countdown on the home page. Grinding Gear Games gave the dates (PST) but
// not the time yet: until data-time is set on an entry ("13:00", PST), it counts days to that date
// in PST; with data-time it counts down to the hour and minute. Without script the date shows.
(function () {
  var PST = -8 * 3600000; // both launches are after daylight saving ends in the US (UTC-8)
  var DAY = 86400000;
  function show() {
    var now = Date.now();
    var todayPst = Math.floor((now + PST) / DAY); // days since 1970 on a PST calendar
    document.querySelectorAll('.league[data-launch]').forEach(function (el) {
      var when = el.querySelector('.lg-when');
      var d = el.getAttribute('data-launch').split('-').map(Number);
      var launchDay = Math.floor(Date.UTC(d[0], d[1] - 1, d[2]) / DAY);
      var time = el.getAttribute('data-time');
      var text;
      if (time) {
        var t = time.split(':').map(Number);
        var ms = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1] || 0) - PST - now;
        if (ms <= 0) text = ms > -DAY ? 'Live now' : 'Out now';
        else { var days = Math.floor(ms / DAY); var h = Math.floor((ms % DAY) / 3600000); var m = Math.floor((ms % 3600000) / 60000); text = (days ? days + 'd ' : '') + h + 'h ' + m + 'm'; }
      } else {
        var left = launchDay - todayPst;
        text = left > 1 ? 'in ' + left + ' days' : left === 1 ? 'tomorrow' : left === 0 ? 'launches today' : 'out now';
      }
      when.textContent = text;
      el.classList.toggle('live', /now|today/.test(text));
      el.title = d.join('-') + ' (PST)' + (time ? ', ' + time : ': the time isn\'t announced yet');
    });
  }
  show();
  setInterval(show, 30000);
}());
