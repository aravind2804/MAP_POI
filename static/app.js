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

  // "Use my location" button
  var LocateControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      var btn = L.DomUtil.create('button', 'locate-btn');
      btn.type = 'button';
      btn.title = 'Use my location';
      btn.setAttribute('aria-label', 'Use my location');
      btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="8"/><line x1="12" y1="1" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="23"/><line x1="1" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="23" y2="12"/></svg>';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function () { locateMe({ manual: true }); });
      return btn;
    }
  });
  map.addControl(new LocateControl());

  // ---------- current location ----------
  // Blue dot + accuracy circle for "you are here".
  var meDot = null, meCircle = null;
  function showMe(lat, lng, accuracy) {
    var ll = L.latLng(lat, lng);
    if (!meDot) {
      meCircle = L.circle(ll, { radius: accuracy || 50, color: '#2563eb', weight: 1, fillOpacity: 0.12, interactive: false }).addTo(map);
      meDot = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1, interactive: false }).addTo(map);
    } else {
      meDot.setLatLng(ll); meCircle.setLatLng(ll); meCircle.setRadius(accuracy || 50);
    }
  }

  // Approximate (city-level) location from the internet connection. Used when GPS/location is off or blocked.
  function ipLocate(manual) {
    if (!manual) return;
    setStatus('Getting your approximate location…');
    fetch('https://ipwho.is/').then(function (r) { return r.json(); }).then(function (d) {
      if (!d || d.success === false || typeof d.latitude !== 'number') throw new Error('no location');
      showMe(d.latitude, d.longitude, 5000);
      setPicked(d.latitude, d.longitude, { reverse: true, force: true });
      map.flyTo([d.latitude, d.longitude], 12);
      var text = 'Showing your approximate location' + (d.city ? ' (' + d.city + ')' : '') + '. Turn on device location for an exact spot.';
      setStatus(text); showMessage(text, 'ok');
    }).catch(function () {
      var text = 'Could not get your location. Turn on location for this device and allow it for this app.';
      setStatus(text, true); showMessage(text, 'error');
    });
  }

  // opts.manual = the person pressed the button; otherwise it runs quietly when the app opens.
  function locateMe(opts) {
    var manual = !!(opts && opts.manual);
    if (!navigator.geolocation) { ipLocate(manual); return; }
    if (manual) setStatus('Getting your location…');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = pos.coords.latitude, lng = pos.coords.longitude;
      showMe(lat, lng, pos.coords.accuracy);
      lastFix = { lat: lat, lng: lng, t: Date.now(), approx: false };
      if (manual || !pickedMarker) setPicked(lat, lng, { fly: true, reverse: true, force: true });
      else map.flyTo([lat, lng], Math.max(map.getZoom(), 16));
      showMessage('', '');
    }, function (err) {
      if (manual && err.code !== 1) { ipLocate(true); return; }
      if (manual) {   // permission denied
        var text = 'Location permission was denied. Allow it in your browser/app settings, or tap the button again for an approximate spot.';
        setStatus(text, true); showMessage(text, 'error');
        ipLocate(true);
      }
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
  }

  // When the app opens and location is on (or can be asked for), go straight to where you are.
  function autoLocateSoon() {
    window.addEventListener('load', function () {
      setTimeout(function () {
        try {
          if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: 'geolocation' }).then(function (p) {
              if (p.state !== 'denied') locateMe({ manual: false });
            }, function () { locateMe({ manual: false }); });
          } else {
            locateMe({ manual: false });
          }
        } catch (e) { /* location not available; the button still works */ }
      }, 900);
    });
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

  // ---------- directions (from my location to a saved place) ----------
  var lastFix = null;          // my last known position
  var routeLayer = null;       // the blue line on the map
  var routeTarget = null;      // the saved place we are going to
  var routeMode = 'car';
  var routeToken = 0;
  var MODES = {
    car:  { service: 'routed-car',  google: 'driving' },
    bike: { service: 'routed-bike', google: 'bicycling' },
    foot: { service: 'routed-foot', google: 'walking' }
  };
  var routePanel = $('route-panel');
  var routeSummary = $('route-summary');
  var routeSteps = $('route-steps');
  var routeTitle = $('route-title');
  var routeGmaps = $('route-gmaps');

  // My position: the real one if location is on, otherwise an approximate one.
  function getFix() {
    return new Promise(function (resolve, reject) {
      if (lastFix && !lastFix.approx && Date.now() - lastFix.t < 120000) { resolve(lastFix); return; }
      function approximate() {
        fetch('https://ipwho.is/').then(function (r) { return r.json(); }).then(function (d) {
          if (!d || d.success === false || typeof d.latitude !== 'number') throw new Error('no location');
          lastFix = { lat: d.latitude, lng: d.longitude, t: Date.now(), approx: true };
          showMe(d.latitude, d.longitude, 5000);
          resolve(lastFix);
        }).catch(reject);
      }
      if (!navigator.geolocation) { approximate(); return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        lastFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: Date.now(), approx: false };
        showMe(lastFix.lat, lastFix.lng, pos.coords.accuracy);
        resolve(lastFix);
      }, approximate, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
  }

  function fmtDistance(m) { return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km'; }
  function fmtDuration(s) {
    var min = Math.max(1, Math.round(s / 60));
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min';
  }
  function stepText(step) {
    var m = step.maneuver || {}, mod = m.modifier || '', road = step.name ? ' onto ' + step.name : '';
    var turn = mod === 'straight' ? 'Continue straight' : 'Turn ' + mod;
    switch (m.type) {
      case 'depart': return 'Head ' + (mod || 'out') + (step.name ? ' on ' + step.name : '');
      case 'arrive': return 'Arrive at your destination' + (mod ? ' (on the ' + mod + ')' : '');
      case 'roundabout': case 'rotary': return 'At the roundabout take exit ' + (m.exit || '') + road;
      case 'end of road': return 'At the end of the road turn ' + mod + road;
      case 'fork': return 'Keep ' + mod + road;
      case 'merge': return 'Merge ' + mod + road;
      case 'on ramp': case 'off ramp': return 'Take the ramp ' + mod + road;
      case 'continue': case 'new name': return 'Continue' + (step.name ? ' on ' + step.name : '');
      default: return turn + road;
    }
  }

  function fetchRoute(from, to, mode) {
    var coords = from.lng + ',' + from.lat + ';' + to.longitude + ',' + to.latitude;
    var query = '?overview=full&geometries=geojson&steps=true';
    var urls = ['https://routing.openstreetmap.de/' + MODES[mode].service + '/route/v1/driving/' + coords + query];
    if (mode === 'car') urls.push('https://router.project-osrm.org/route/v1/driving/' + coords + query);
    function attempt(i) {
      return fetch(urls[i]).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.routes && d.routes.length) return d.routes[0];
        if (d && d.code === 'NoRoute') throw new Error('noroute');
        throw new Error('bad');
      }).catch(function (err) {
        if (err.message === 'noroute' || i + 1 >= urls.length) throw err;
        return attempt(i + 1);
      });
    }
    return attempt(0);
  }

  function clearRoute() {
    routeToken++;
    routeTarget = null;
    if (routeLayer) { routeLayer.remove(); routeLayer = null; }
    routePanel.hidden = true;
    document.body.classList.remove('routing');
  }

  function showDirections(loc, mode) {
    if (mode) routeMode = mode;
    routeTarget = loc;
    var token = ++routeToken;
    if (isMobile()) setView('map');
    document.body.classList.add('routing');
    routePanel.hidden = false;
    routeTitle.textContent = 'To ' + loc.name;
    routeSummary.className = 'route-summary';
    routeSummary.textContent = 'Finding your location\u2026';
    routeSteps.textContent = '';
    routeGmaps.hidden = true;
    Array.prototype.forEach.call($('route-modes').children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === routeMode);
    });
    if (routeLayer) { routeLayer.remove(); routeLayer = null; }

    getFix().then(function (from) {
      if (token !== routeToken) return null;
      routeSummary.textContent = 'Finding the route\u2026';
      return fetchRoute(from, loc, routeMode).then(function (route) {
        if (token !== routeToken) return;
        routeLayer = L.geoJSON(route.geometry, { style: { color: '#2563eb', weight: 6, opacity: 0.85 }, interactive: false }).addTo(map);
        map.fitBounds(routeLayer.getBounds(), { paddingTopLeft: [40, 40], paddingBottomRight: [40, isMobile() ? 280 : 60] });
        routeSummary.textContent = fmtDistance(route.distance) + ' \u00B7 ' + fmtDuration(route.duration) + (from.approx ? '  (from your approximate location)' : '');
        (route.legs || []).forEach(function (leg) {
          (leg.steps || []).forEach(function (s) {
            routeSteps.appendChild(el('li', {}, [
              el('span', { text: stepText(s) + ' ' }),
              el('small', { text: '(' + fmtDistance(s.distance) + ')' })
            ]));
          });
        });
        routeGmaps.hidden = false;
        routeGmaps.onclick = function () {
          openExternal('https://www.google.com/maps/dir/?api=1&origin=' + from.lat + ',' + from.lng +
            '&destination=' + loc.latitude + ',' + loc.longitude + '&travelmode=' + MODES[routeMode].google);
        };
      });
    }).catch(function (err) {
      if (token !== routeToken) return;
      routeSummary.className = 'route-summary error';
      routeSummary.textContent = err && err.message === 'noroute'
        ? 'No route found for this travel mode.'
        : 'Could not get directions. Turn on location and check your internet connection.';
    });
  }

  function openExternal(url) {
    var onThisPc = !LOCAL && (location.hostname === '127.0.0.1' || location.hostname === 'localhost');
    if (onThisPc) {   // inside the desktop window: open the system browser
      fetch('/api/open_external', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url }) })
        .then(function (r) { if (!r.ok) throw new Error('x'); }).catch(function () { window.open(url, '_blank'); });
    } else {
      window.open(url, '_blank');
    }
  }

  $('route-close').addEventListener('click', clearRoute);
  Array.prototype.forEach.call($('route-modes').children, function (b) {
    b.addEventListener('click', function () { if (routeTarget) showDirections(routeTarget, b.getAttribute('data-mode')); });
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
      marker.on('click', function () { showDirections(loc); });

      var showBtn = el('button', { type: 'button', 'class': 'btn small ghost', text: 'Show on map' });
      showBtn.addEventListener('click', function () {
        if (isMobile()) setView('map');
        map.flyTo([loc.latitude, loc.longitude], Math.max(map.getZoom(), 15));
        marker.openPopup();
      });

      var dirBtn = el('button', { type: 'button', 'class': 'btn small primary', text: 'Directions' });
      dirBtn.addEventListener('click', function () { showDirections(loc); });

      var deleteBtn = el('button', { type: 'button', 'class': 'btn small danger', text: 'Delete' });
      armDelete(deleteBtn, loc);

      var item = el('li', { 'class': 'clickable' }, [
        el('div', { 'class': 'item-name', text: loc.name }),
        el('div', { 'class': 'item-cat' }, [
          el('span', { 'class': 'dot', style: '--c:' + colorFor(loc.category) }),
          el('span', { text: loc.category || 'Other' })
        ]),
        loc.address ? el('p', { 'class': 'item-address', text: loc.address }) : el('span'),
        loc.description ? el('p', { 'class': 'item-desc', text: loc.description }) : el('span'),
        el('div', { 'class': 'item-coords', text: Number(loc.latitude).toFixed(6) + ', ' + Number(loc.longitude).toFixed(6) }),
        el('div', { 'class': 'item-actions' }, [dirBtn, showBtn, deleteBtn])
      ]);
      item.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('button')) return;
        showDirections(loc);
      });
      listEl.appendChild(item);
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
  autoLocateSoon();
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

(function () {
  var link = document.getElementById('phone-link');
  if (link && window.POI_MODE === 'local') link.hidden = true;
})();

(function () {
  if (window.POI_MODE !== 'local') return;   // only the hosted phone (https) version can be installed
  var bar = document.getElementById('install-bar');
  var btn = document.getElementById('install-btn');
  var text = document.getElementById('install-text');
  var close = document.getElementById('install-close');
  if (!bar) return;
  var installed = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone;
  if (installed) return;
  var ua = navigator.userAgent;
  var deferred = null;
  function show(msg, showBtn, label, handler) {
    text.textContent = msg;
    btn.hidden = !showBtn;
    if (label) btn.textContent = label;
    btn.onclick = handler || null;
    bar.hidden = false;
  }
  close.addEventListener('click', function () { bar.hidden = true; });

  // Instagram / Facebook / other in-app browsers cannot install apps: send the person to Chrome / Safari.
  if (/Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|MicroMessenger/i.test(ua)) {
    if (/android/i.test(ua)) {
      var target = 'intent://' + location.host + location.pathname + '#Intent;scheme=https;package=com.android.chrome;end';
      show('To install the app, open this page in Chrome.', true, 'Open in Chrome', function () { location.href = target; });
    } else {
      show('To install: tap the \u22EF menu, choose "Open in Safari", then Share \u2192 Add to Home Screen.', false);
    }
    return;
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    show('Install POI Map as an app', true, 'Install POI Map', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; bar.hidden = true; });
    });
  });
  window.addEventListener('appinstalled', function () { bar.hidden = true; });

  if (/iphone|ipad|ipod/i.test(ua)) {   // iPhone has no install button
    show('To install: tap Share, then "Add to Home Screen".', false);
  } else {
    // If Chrome has not offered the install prompt after a few seconds, explain the manual way.
    setTimeout(function () {
      if (!deferred && bar.hidden) show('To install: tap the \u22EE menu, then "Install app" or "Add to Home screen".', false);
    }, 4000);
  }
})();
