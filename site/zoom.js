// Click a screenshot to see it larger. Click anywhere or press Esc to close. Without script the
// screenshots just stay the size they are.
(function () {
  var shots = document.querySelectorAll('figure.frame img');
  if (!shots.length || typeof HTMLDialogElement !== 'function') return;
  var box = document.createElement('dialog');
  box.className = 'zoom';
  box.setAttribute('aria-label', 'Screenshot, larger');
  var big = document.createElement('img');
  box.appendChild(big);
  document.body.appendChild(box);
  box.addEventListener('click', function () { box.close(); });
  box.addEventListener('close', function () { big.removeAttribute('src'); });
  function open(img) {
    big.src = img.currentSrc || img.src;
    big.alt = img.alt;
    box.showModal();
  }
  shots.forEach(function (img) {
    img.classList.add('zoomable');
    img.tabIndex = 0;
    img.setAttribute('role', 'button');
    img.setAttribute('aria-label', 'Show larger: ' + img.alt);
    img.addEventListener('click', function () { open(img); });
    img.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(img); }
    });
  });
})();
