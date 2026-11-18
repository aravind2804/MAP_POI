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

  var LOCAL = window.POI_MODE === 'local';   // true = standalone phone mode (no Flask server)
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
    if (typeof updateSheet === 'function') updateSheet();
  }

  var toastEl = $('toast');
  var toastTimer = null;
  function showMessage(text, kind) {
    message.textContent = text;
    message.className = kind || '';
    if (text && toastEl) {
      toastEl.textContent = text;
      toastEl.className = 'toast show ' + (kind || '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.className = 'toast'; }, 3200);
    }
  }

  function api(url, options) {
    return fetch(url, options).then(function (r) {
      return r.text().then(function (text) {
        var body = null;
        try { body = JSON.parse(text); } catch (e) { /* not JSON (for example an HTML error page) */ }
        if (!r.ok || body === null) {
          throw new Error((body && body.error) || 'Could not reach the map service. Check your internet connection.');
        }
        return body;
      });
    });
  }

  // ---------- data layer ----------
  // 'server' mode talks to the Flask app. 'local' mode (phone / installed web app)
  // keeps places on the device and calls OpenStreetMap Nominatim directly.
  var STORE_KEY = 'poi_map_locations_v1';
  var memoryStore = null;
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
    catch (e) { return memoryStore || []; }
  }
  function writeStore(list) {
    memoryStore = list;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) { /* private mode */ }
  }

  var lastNominatim = 0;
  var nominatimCache = {};
  var nominatimQueue = Promise.resolve();
  function nominatim(path, params) {
    var query = Object.keys(params).sort().map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    var url = 'https://nominatim.openstreetmap.org' + path + '?' + query + '&accept-language=en';
    if (nominatimCache[url]) return Promise.resolve(nominatimCache[url]);
    // Nominatim allows 1 request per second: queue calls.
    var job = nominatimQueue.then(function () {
      var wait = Math.max(0, 1000 - (Date.now() - lastNominatim));
      return new Promise(function (r) { setTimeout(r, wait); });
    }).then(function () {
      lastNominatim = Date.now();
      return fetch(url);
    }).then(function (r) {
      if (!r.ok) throw new Error('bad status');
      return r.json();
    }).then(function (json) { nominatimCache[url] = json; return json; });
    nominatimQueue = job.catch(function () {});
    return job.catch(function () {
      throw new Error('Could not reach the map search service. Check your internet connection.');
    });
  }

  var data = {
    search: function (q) {
      if (!LOCAL) return api('/api/search?q=' + encodeURIComponent(q));
      return nominatim('/search', { format: 'jsonv2', q: q, limit: 6 }).then(function (items) {
        return { results: items.map(function (i) {
          return { name: i.display_name || '', latitude: parseFloat(i.lat), longitude: parseFloat(i.lon) };
        }) };
      });
    },
    reverse: function (lat, lng) {
      if (!LOCAL) return api('/api/reverse?lat=' + lat + '&lng=' + lng);
      return nominatim('/reverse', { format: 'jsonv2', lat: lat.toFixed(5), lon: lng.toFixed(5), zoom: 18 })
        .then(function (d) { return { address: d.error ? '' : (d.display_name || '') }; });
    },
    list: function () {
      if (!LOCAL) return api('/get_locations');
      return Promise.resolve(readStore().sort(function (a, b) { return b.id - a.id; }));
    },
    save: function (loc) {
      if (!LOCAL) {
        return api('/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loc)
        });
      }
      var list = readStore();
      var id = list.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0) + 1;
      list.push({
        id: id, name: loc.name, category: loc.category || 'Other',
        latitude: loc.latitude, longitude: loc.longitude,
        description: loc.description || '', address: loc.address || ''
      });
      writeStore(list);
      return Promise.resolve({ message: 'Location Saved Successfully' });
    },
    remove: function (id) {
      if (!LOCAL) {
        return fetch('/delete/' + id, { method: 'DELETE' }).then(function (r) {
          if (!r.ok) throw new Error('Could not delete the location.');
        });
      }
      writeStore(readStore().filter(function (x) { return x.id !== id; }));
      return Promise.resolve();
    }
  };

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

  // ---------- mobile views (Map / Add / Saved tabs) ----------
  var isMobile = function () { return window.matchMedia('(max-width: 860px)').matches; };
  var tabButtons = document.querySelectorAll('.tabs button');
  var addFab = $('add-fab');
  var map = null; // assigned below
  function setView(view) {
    document.body.setAttribute('data-view', view);
    Array.prototype.forEach.call(tabButtons, function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
      b.setAttribute('aria-selected', b.getAttribute('data-view') === view ? 'true' : 'false');
    });
    updateFab();
    if (view === 'map' && map) setTimeout(function () { map.invalidateSize(); }, 50);
  }
  var sheet = $('pick-sheet');
  var sheetAddr = $('pick-address');
  var sheetCoords = $('pick-coords');
  function updateFab() {
    var show = !!(pickedMarker && document.body.getAttribute('data-view') === 'map');
    if (addFab) addFab.hidden = !show;
    if (sheet) sheet.hidden = !show;
    if (show) updateSheet();
  }
  function updateSheet() {
    if (!sheet) return;
    sheetCoords.textContent = latInput.value && lngInput.value ? latInput.value + ', ' + lngInput.value : '';
    sheetAddr.textContent = addressInput.value.trim() || geoStatus.textContent || 'Pin placed.';
  }
  Array.prototype.forEach.call(tabButtons, function (b) {
    b.addEventListener('click', function () { setView(b.getAttribute('data-view')); });
  });
  var sheetBtn = $('pick-add');
  if (sheetBtn) sheetBtn.addEventListener('click', function () { setView('add'); });
  if (addFab) addFab.addEventListener('click', function () { setView('add'); nameInput.focus(); });
  window.addEventListener('resize', function () { if (map) map.invalidateSize(); });

  // ---------- map ----------
  map = L.map('map', { tap: true }).setView([11.1271, 78.6569], 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  // "Use my location" button (works on phones; needs https or localhost)
  var LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      var btn = L.DomUtil.create('button', 'locate-btn');
      btn.type = 'button';
      btn.title = 'Use my location';
      btn.setAttribute('aria-label', 'Use my location');
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', locateMe);
      return btn;
    }
  });
  map.addControl(new LocateControl());

  function locateMe() {
    if (!navigator.geolocation) { setStatus('Location is not supported on this device.', true); showMessage('Location is not supported on this device.', 'error'); return; }
    setStatus('Getting your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      setPicked(pos.coords.latitude, pos.coords.longitude, { fly: true, reverse: true, force: true });
      showMessage('', '');
    }, function (err) {
      var text = err.code === 1
        ? 'Location permission was denied. Allow it in your browser settings.'
        : 'Could not get your location. On a phone this needs https (or the installed app).';
      setStatus(text, true);
      showMessage(text, 'error');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }

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
    updateFab();
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
    data.reverse(lat, lng)
      .then(function (body) {
        if (token !== reverseToken) return;
        if (body.address) {
          addressInput.value = body.address;
          addressAuto = true;
          setStatus('Address found.');
          updateSheet();
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
    data.search(q)
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
    if (!isMobile()) nameInput.focus();
  }

  searchForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = searchQ.value.trim();
    if (q.length < 2) { showNote('Type at least 2 characters to search.', true); return; }
    searchBtn.disabled = true;
    showNote('Searching…');
    data.search(q)
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
        if (isMobile()) setView('map');
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
    return data.list().then(function (list) { locations = list; render(); });
  }

  function deleteLocation(id) {
    data.remove(id)
      .then(refresh)
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
    updateFab();
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

    data.save({
      name: name,
      category: categoryInput.value,
      address: addressInput.value.trim(),
      latitude: lat,
      longitude: lng,
      description: descInput.value.trim()
    })
      .then(refresh)
      .then(function () {
        clearForm();
        showMessage('Saved "' + name + '".', 'ok');
        map.flyTo([lat, lng], Math.max(map.getZoom(), 15));
        if (isMobile()) setView('saved');
      })
      .catch(function (err) { showMessage(err.message, 'error'); });
  });

  // ---------- backup: export / import ----------
  $('export-btn').addEventListener('click', function () {
    var blob = new Blob([JSON.stringify(locations, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'poi-locations.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  var importFile = $('import-file');
  $('import-btn').addEventListener('click', function () { importFile.click(); });
  importFile.addEventListener('change', function () {
    var file = importFile.files[0];
    importFile.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var items;
      try { items = JSON.parse(reader.result); } catch (e) { items = null; }
      if (!Array.isArray(items)) { showMessage('That file is not a valid locations backup.', 'error'); return; }
      var seen = {};
      locations.forEach(function (l) { seen[l.name + '|' + l.latitude + '|' + l.longitude] = true; });
      var chain = Promise.resolve();
      var added = 0;
      items.forEach(function (it) {
        var lat = parseFloat(it.latitude), lng = parseFloat(it.longitude);
        var name = String(it.name || '').trim();
        if (!name || !validCoords(lat, lng) || seen[name + '|' + lat + '|' + lng]) return;
        seen[name + '|' + lat + '|' + lng] = true;
        added++;
        chain = chain.then(function () {
          return data.save({ name: name, category: it.category || 'Other', address: it.address || '',
                             latitude: lat, longitude: lng, description: it.description || '' });
        });
      });
      chain.then(refresh).then(function () {
        showMessage(added + ' location' + (added === 1 ? '' : 's') + ' imported.', 'ok');
      }).catch(function (err) { showMessage(err.message, 'error'); });
    };
    reader.readAsText(file);
  });

  filterSearch.addEventListener('input', render);
  filterCategory.addEventListener('change', render);

  setView('map');
  if (LOCAL) {
    refresh().then(fitAll);
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  } else {
    render();
    fitAll();
  }
})();
