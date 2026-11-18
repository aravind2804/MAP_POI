(function () {
  'use strict';

  var CATEGORIES = {
    'Restaurant': '#e4572e',
    'Hospital': '#d62839',
    'School': '#3f6fd8',
    'Park': '#2f9e44',
    'Shop': '#9b5de5',
    'Tourist place': '#f59f00',
    'Other': '#5c6b73'
  };
  var PICK_COLOR = '#e4572e';

  var locations = Array.isArray(window.INITIAL_POI) ? window.INITIAL_POI : [];
  var markers = {};          // saved location id -> marker
  var pickedMarker = null;   // the pin for the location you are adding
  var addressAuto = true;    // true while the address was filled in automatically
  var reverseToken = 0;      // ignores out-of-date address lookups
  var coordTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var form = $('poi-form');
  var nameInput = $('name');
  var categoryInput = $('category');
  var addressInput = $('address');
  var latInput = $('latitude');
  var lngInput = $('longitude');
  var descInput = $('description');
  var geoStatus = $('geo-status');
  var message = $('message');
  var listEl = $('list');
  var emptyEl = $('empty');
  var countEl = $('count');
  var totalEl = $('total');
  var filterSearch = $('search');
  var filterCategory = $('filter');
  var searchForm = $('search-form');
  var searchQ = $('search-q');
  var searchBtn = $('search-btn');
  var resultsEl = $('search-results');
  var findBtn = $('find-address');

  // ---------- helpers ----------
  function colorFor(category) { return CATEGORIES[category] || CATEGORIES.Other; }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (key) {
      if (key === 'text') node.textContent = attrs[key];
      else if (key === 'class') node.className = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    (children || []).forEach(function (child) { node.appendChild(child); });
    return node;
  }

  function setStatus(text, isError) {
    geoStatus.textContent = text || '';
    geoStatus.className = 'status' + (isError ? ' error' : '');
  }

  function showMessage(text, kind) {
    message.textContent = text;
    message.className = kind || '';
  }

  function api(url, options) {
    return fetch(url, options).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || 'Something went wrong.');
        return body;
      });
    });
  }

  function validCoords(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function pinIcon(color) {
    return L.divIcon({
      className: 'pin-wrap',
      html: '<span class="pin" style="--pin:' + color + '"></span>',
      iconSize: [28, 28],
      iconAnchor: [8, 30],
      popupAnchor: [6, -28]
    });
  }

  function popupFor(loc) {
    return el('div', {}, [
      el('div', { 'class': 'popup-name', text: loc.name }),
      el('div', { 'class': 'popup-meta', text: loc.category || 'Other' }),
      loc.address ? el('p', { 'class': 'popup-address', text: loc.address }) : el('span'),
      loc.description ? el('p', { 'class': 'popup-desc', text: loc.description }) : el('span')
    ]);
  }

  // ---------- dropdowns ----------
  Object.keys(CATEGORIES).forEach(function (name) {
    categoryInput.appendChild(el('option', { value: name, text: name }));
  });
  filterCategory.appendChild(el('option', { value: '', text: 'All categories' }));
  Object.keys(CATEGORIES).forEach(function (name) {
    filterCategory.appendChild(el('option', { value: name, text: name }));
  });

  // ---------- map ----------
  var map = L.map('map').setView([11.1271, 78.6569], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  // ---------- the pin you are placing ----------
  // Put the pin at lat/lng. Options:
  //   fly: move the map there    reverse: look up the address
  //   force: replace the address even if you typed one   fromInputs: don't rewrite lat/lng boxes
  function setPicked(lat, lng, opts) {
    opts = opts || {};
    var latlng = L.latLng(lat, lng);

    if (!pickedMarker) {
      pickedMarker = L.marker(latlng, { icon: pinIcon(PICK_COLOR), draggable: true }).addTo(map);
      pickedMarker.on('dragend', function () {
        var p = pickedMarker.getLatLng();
        setPicked(p.lat, p.lng, { reverse: true, force: true });
      });
    } else {
      pickedMarker.setLatLng(latlng);
    }

    if (!opts.fromInputs) {
      latInput.value = lat.toFixed(6);
      lngInput.value = lng.toFixed(6);
    }
    if (opts.fly) map.flyTo(latlng, Math.max(map.getZoom(), 16));
    if (opts.reverse) lookupAddress(lat, lng, !!opts.force);
  }

  function lookupAddress(lat, lng, force) {
    var typed = addressInput.value.trim();
    if (!force && !addressAuto && typed) {
      setStatus('Pin placed. Your typed address was kept.');
      return;
    }
    var token = ++reverseToken;
    setStatus('Finding the address…');
    api('/api/reverse?lat=' + lat + '&lng=' + lng)
      .then(function (body) {
        if (token !== reverseToken) return;
        if (body.address) {
          addressInput.value = body.address;
          addressAuto = true;
          setStatus('Address found.');
        } else {
          setStatus('No address found for this spot. You can type one.');
        }
      })
      .catch(function (err) {
        if (token !== reverseToken) return;
        setStatus(err.message + ' You can type the address yourself.', true);
      });
  }

  // 1) Click on the map -> coordinates + address
  map.on('click', function () { hideResults(); });
  map.on('click', function (e) {
    setPicked(e.latlng.lat, e.latlng.lng, { reverse: true, force: true });
    showMessage('', '');
  });

  // 2) Type coordinates -> pin on the map (+ address)
  function applyTypedCoords() {
    var lat = parseFloat(latInput.value);
    var lng = parseFloat(lngInput.value);
    if (latInput.value.trim() === '' || lngInput.value.trim() === '') return;
    if (!validCoords(lat, lng)) {
      setStatus('Latitude must be -90 to 90 and longitude -180 to 180.', true);
      return;
    }
    setPicked(lat, lng, { fly: true, reverse: true, fromInputs: true });
  }
  [latInput, lngInput].forEach(function (input) {
    input.addEventListener('input', function () {
      clearTimeout(coordTimer);
      coordTimer = setTimeout(applyTypedCoords, 700);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(coordTimer); applyTypedCoords(); }
    });
  });

  // 3) Type an address -> pin on the map (+ coordinates)
  addressInput.addEventListener('input', function () {
    addressAuto = addressInput.value.trim() === '';
  });
  addressInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); findTypedAddress(); }
  });
  findBtn.addEventListener('click', findTypedAddress);

  function findTypedAddress() {
    var q = addressInput.value.trim();
    if (q.length < 2) { setStatus('Type an address first.', true); addressInput.focus(); return; }
    setStatus('Looking for this address…');
    findBtn.disabled = true;
    api('/api/search?q=' + encodeURIComponent(q))
      .then(function (body) {
        if (!body.results.length) {
          setStatus('Address not found. Try adding the city or pincode.', true);
          return;
        }
        var first = body.results[0];
        setPicked(first.latitude, first.longitude, { fly: true });
        setStatus('Pin placed on the best match. Drag the pin to adjust it.');
      })
      .catch(function (err) { setStatus(err.message, true); })
      .then(function () { findBtn.disabled = false; });
  }

  // ---------- top search bar ----------
  function hideResults() { resultsEl.hidden = true; resultsEl.textContent = ''; }

  function showNote(text, isError) {
    resultsEl.textContent = '';
    resultsEl.appendChild(el('li', { 'class': 'note' + (isError ? ' error' : ''), text: text }));
    resultsEl.hidden = false;
  }

  function choosePlace(place) {
    hideResults();
    searchQ.value = place.name;
    setPicked(place.latitude, place.longitude, { fly: true });
    addressInput.value = place.name;
    addressAuto = true;
    setStatus('Place selected. Add a name and press Save location.');
    if (!nameInput.value.trim()) nameInput.value = place.name.split(',')[0].trim();
    nameInput.focus();
  }

  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = searchQ.value.trim();
    if (q.length < 2) { showNote('Type at least 2 characters to search.', true); return; }
    searchBtn.disabled = true;
    showNote('Searching…');
    api('/api/search?q=' + encodeURIComponent(q))
      .then(function (body) {
        if (!body.results.length) { showNote('No places found. Try a different spelling or add the city.'); return; }
        resultsEl.textContent = '';
        body.results.forEach(function (place) {
          var parts = place.name.split(',');
          var title = parts[0].trim();
          var rest = parts.slice(1).join(',').trim();
          var button = el('button', { type: 'button' }, [
            el('span', { 'class': 'result-title', text: title }),
            el('span', { 'class': 'result-sub', text: rest })
          ]);
          button.addEventListener('click', function () { choosePlace(place); });
          resultsEl.appendChild(el('li', {}, [button]));
        });
        resultsEl.hidden = false;
      })
      .catch(function (err) { showNote(err.message, true); })
      .then(function () { searchBtn.disabled = false; });
  });

  document.addEventListener('click', function (e) {
    if (!searchForm.contains(e.target)) hideResults();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideResults();
  });

  // ---------- saved locations list ----------
  function visibleLocations() {
    var query = filterSearch.value.trim().toLowerCase();
    var category = filterCategory.value;
    return locations.filter(function (loc) {
      var text = (String(loc.name) + ' ' + String(loc.address || '')).toLowerCase();
      return (!query || text.indexOf(query) !== -1) && (!category || loc.category === category);
    });
  }

  function armDelete(button, loc) {
    var armed = false;
    var timer = null;
    button.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        button.textContent = 'Confirm delete';
        timer = setTimeout(function () { armed = false; button.textContent = 'Delete'; }, 3000);
        return;
      }
      clearTimeout(timer);
      deleteLocation(loc.id);
    });
  }

  function render() {
    Object.keys(markers).forEach(function (id) { markers[id].remove(); });
    markers = {};
    listEl.textContent = '';

    var shown = visibleLocations();
    totalEl.textContent = locations.length;
    countEl.textContent = '(' + shown.length + (shown.length !== locations.length ? ' of ' + locations.length : '') + ')';

    emptyEl.hidden = shown.length > 0;
    emptyEl.textContent = locations.length === 0
      ? 'No locations yet. Click the map or search a place to add your first one.'
      : 'No saved locations match your filter.';

    shown.forEach(function (loc) {
      var marker = L.marker([loc.latitude, loc.longitude], { icon: pinIcon(colorFor(loc.category)) })
        .bindPopup(popupFor(loc))
        .addTo(map);
      markers[loc.id] = marker;

      var showBtn = el('button', { type: 'button', 'class': 'btn small ghost', text: 'Show on map' });
      showBtn.addEventListener('click', function () {
        map.flyTo([loc.latitude, loc.longitude], Math.max(map.getZoom(), 15));
        marker.openPopup();
      });

      var deleteBtn = el('button', { type: 'button', 'class': 'btn small danger', text: 'Delete' });
      armDelete(deleteBtn, loc);

      listEl.appendChild(el('li', {}, [
        el('div', { 'class': 'item-name', text: loc.name }),
        el('div', { 'class': 'item-cat' }, [
          el('span', { 'class': 'dot', style: '--c:' + colorFor(loc.category) }),
          el('span', { text: loc.category || 'Other' })
        ]),
        loc.address ? el('p', { 'class': 'item-address', text: loc.address }) : el('span'),
        loc.description ? el('p', { 'class': 'item-desc', text: loc.description }) : el('span'),
        el('div', { 'class': 'item-coords', text: Number(loc.latitude).toFixed(6) + ', ' + Number(loc.longitude).toFixed(6) }),
        el('div', { 'class': 'item-actions' }, [showBtn, deleteBtn])
      ]));
    });
  }

  function fitAll() {
    if (locations.length === 0) return;
    var bounds = L.latLngBounds(locations.map(function (l) { return [l.latitude, l.longitude]; }));
    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
  }

  function refresh() {
    return api('/get_locations').then(function (data) { locations = data; render(); });
  }

  function deleteLocation(id) {
    fetch('/delete/' + id, { method: 'DELETE' })
      .then(function (r) {
        if (!r.ok) throw new Error('Could not delete the location.');
        return refresh();
      })
      .then(function () { showMessage('Location deleted.', 'ok'); })
      .catch(function (err) { showMessage(err.message, 'error'); });
  }

  // ---------- save / clear ----------
  function clearForm() {
    form.reset();
    addressAuto = true;
    reverseToken++;
    setStatus('');
    if (pickedMarker) { pickedMarker.remove(); pickedMarker = null; }
  }
  $('clear-btn').addEventListener('click', function () { clearForm(); showMessage('', ''); });

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var name = nameInput.value.trim();
    var lat = parseFloat(latInput.value);
    var lng = parseFloat(lngInput.value);

    if (!name) { showMessage('Enter a name for the location.', 'error'); nameInput.focus(); return; }
    if (!validCoords(lat, lng)) {
      showMessage('Click the map, search a place, or enter valid latitude and longitude.', 'error');
      return;
    }

    api('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        category: categoryInput.value,
        address: addressInput.value.trim(),
        latitude: lat,
        longitude: lng,
        description: descInput.value.trim()
      })
    })
      .then(refresh)
      .then(function () {
        clearForm();
        showMessage('Saved "' + name + '".', 'ok');
        map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
      })
      .catch(function (err) { showMessage(err.message, 'error'); });
  });

  filterSearch.addEventListener('input', render);
  filterCategory.addEventListener('change', render);

  render();
  fitAll();
})();
