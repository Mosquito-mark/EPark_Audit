// ==========================================================================
// EPark Zone Audit Application - Core Logic
// ==========================================================================

// Application State
const state = {
  audits: {},            // Saved audits: { zoneId: { carsParked, driverOccupied, impeded: [], notes, timestamp, signMatches } }
  selectedZone: null,    // Currently highlighted/selected zone object
  gpsActive: false,      // Is Geolocation tracking currently active
  audioEnabled: false,   // Has user allowed audio playback gesture
  currentLocation: null, // Last recorded GPS lat/lng [lat, lng]
  insideZoneId: null,    // ID of the zone the user is currently standing inside
  activeTab: 'map',      // Active view: 'map' or 'analytics'
  searchQuery: '',
  filterStatus: 'all',   // Filter status on map: 'all', 'pending', 'completed', 'impeded'
  formIsDirty: false     // Unsaved form modifications
};

// Global variables for Leaflet & Charts
let map = null;
let locationMarker = null;
let locationCircle = null;
let zonesGroup = null;
let accessibleGroup = null;
let chartCars = null;
let chartImpediments = null;

// Map tile layers
const tileLayers = {
  voyager: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }),
  dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
  }),
  satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  })
};

// ==========================================================================
// Spatial Helpers (Point-in-Polygon & Centroid)
// ==========================================================================

/**
 * Ray-casting algorithm to determine if a lat/lng point is inside a polygon
 * Polygon format: array of [lat, lng]
 */
function isPointInPolygon(point, polygon) {
  const x = point[0]; // Latitude
  const y = point[1]; // Longitude
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect = ((yi > y) !== (yj > y))
        && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Calculates the center (centroid) of a set of polygon vertices
 */
function getPolygonCentroid(coordinates) {
  let latSum = 0;
  let lngSum = 0;
  coordinates.forEach(coord => {
    latSum += coord[0];
    lngSum += coord[1];
  });
  return [latSum / coordinates.length, lngSum / coordinates.length];
}

// ==========================================================================
// Data Processing & Mapping Setup
// ==========================================================================

// LocalStorage Management
function loadAudits() {
  const saved = localStorage.getItem('epark_audits');
  if (saved) {
    try {
      state.audits = JSON.parse(saved);
    } catch (e) {
      console.error("Error parsing saved audits", e);
      state.audits = {};
    }
  }
}

function saveAudits() {
  localStorage.setItem('epark_audits', JSON.stringify(state.audits));
  updateStats();
}

/**
 * Pre-processes EPark zones to assign their region and BIA on startup
 */
const processedZones = [];
function preprocessMapData() {
  const rawZones = window.zonesData["EPark Zones"] || [];
  const rawRegions = window.zonesData["Parking Regions"] || [];
  const rawBIAs = window.zonesData["Business Improvement Areas (BIAs)"] || [];

  rawZones.forEach(zone => {
    // 1. Calculate centroid
    const centroid = getPolygonCentroid(zone.geometry.coordinates);
    
    // 2. Resolve Parking Region
    let resolvedRegion = "None";
    for (let i = 0; i < rawRegions.length; i++) {
      const region = rawRegions[i];
      if (region.geometry && isPointInPolygon(centroid, region.geometry.coordinates)) {
        resolvedRegion = region.name;
        break;
      }
    }

    // 3. Resolve BIA Area
    let resolvedBIA = "None";
    for (let i = 0; i < rawBIAs.length; i++) {
      const bia = rawBIAs[i];
      if (bia.geometry && isPointInPolygon(centroid, bia.geometry.coordinates)) {
        resolvedBIA = bia.name;
        break;
      }
    }

    // Add to processed zones list
    processedZones.push({
      ...zone,
      centroid: centroid,
      region: resolvedRegion,
      bia: resolvedBIA
    });
  });
}

/**
 * Styling polygons dynamically based on audit status
 */
function getZoneStyle(zoneName) {
  const audit = state.audits[zoneName];
  if (audit) {
    // Check if it was impeded
    if (audit.impeded && audit.impeded.length > 0) {
      return {
        fillColor: '#d84315', // warning red-orange
        weight: 2,
        opacity: 0.8,
        color: '#b23c17',
        fillOpacity: 0.6
      };
    } else {
      return {
        fillColor: '#2e7d32', // success green
        weight: 2,
        opacity: 0.8,
        color: '#1b5e20',
        fillOpacity: 0.6
      };
    }
  }
  
  // Pending default color
  return {
    fillColor: '#5c6bc0', // pending soft blue-violet
    weight: 1.5,
    opacity: 0.7,
    color: '#3f51b5',
    fillOpacity: 0.35
  };
}

// ==========================================================================
// Web Audio API Chime Synthesis (No external file needed)
// ==========================================================================

function playBellChime() {
  if (!state.audioEnabled) return;
  
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    // Arpeggio notes representing a clean warning/notification bell chime: C5, E5, G5, C6
    const frequencies = [523.25, 659.25, 783.99, 1046.50];
    
    frequencies.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08); // Arpeggiated sequence
      
      // Volume envelope to represent decay sound
      gainNode.gain.setValueAtTime(0, now + idx * 0.08);
      gainNode.gain.linearRampToValueAtTime(idx === 3 ? 0.35 : 0.15, now + idx * 0.08 + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 1.0); // Ring decay
      
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 1.2);
    });
    
    showToast("Audio Tracker Alert Played", "success");
  } catch (e) {
    console.error("Failed to play Web Audio chime:", e);
  }
}

/**
 * Synthesizes an audible alarm alert warning for unsaved changes
 */
function playAlarmSound() {
  if (!state.audioEnabled) return;
  
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    osc.type = 'sawtooth'; // Harsh waveform for alarms
    osc.frequency.setValueAtTime(600, now);
    
    // Siren-like pitch oscillation
    osc.frequency.linearRampToValueAtTime(800, now + 0.15);
    osc.frequency.linearRampToValueAtTime(600, now + 0.30);
    osc.frequency.linearRampToValueAtTime(800, now + 0.45);
    osc.frequency.linearRampToValueAtTime(600, now + 0.60);
    
    // Volume envelope (loud siren burst)
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.35, now + 0.05);
    gainNode.gain.setValueAtTime(0.35, now + 0.55);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
    
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    osc.start(now);
    osc.stop(now + 0.9);
    
    showToast("Warning: Unsaved Changes!", "error");
  } catch (e) {
    console.error("Failed to play Web Audio alarm sound:", e);
  }
}

// ==========================================================================
// UI Notifications
// ==========================================================================

function showToast(message, type = "success") {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `coe-toast toast-${type}`;
  
  const icon = type === "success" 
    ? '<i class="fa-solid fa-circle-check"></i>' 
    : '<i class="fa-solid fa-circle-exclamation"></i>';
    
  toast.innerHTML = `${icon} <span>${message}</span>`;
  container.appendChild(toast);
  
  // Remove toast from DOM after animations complete (3.5s total)
  setTimeout(() => {
    toast.remove();
  }, 3500);
}

// ==========================================================================
// Stats Dashboard Update
// ==========================================================================

function updateStats() {
  const totalZones = processedZones.length;
  const completedKeys = Object.keys(state.audits);
  const completedCount = completedKeys.length;
  
  // Update progress numbers
  document.getElementById('stat-progress-txt').innerText = `${completedCount} / ${totalZones}`;
  const pct = totalZones > 0 ? (completedCount / totalZones) * 100 : 0;
  document.getElementById('stat-progress-bar').style.width = `${pct}%`;
  
  // Calculate aggregate counts
  let totalParked = 0;
  let totalOccupied = 0;
  let impededCount = 0;
  
  completedKeys.forEach(key => {
    const audit = state.audits[key];
    totalParked += parseInt(audit.carsParked || 0);
    totalOccupied += parseInt(audit.driverOccupied || 0);
    if (audit.impeded && audit.impeded.length > 0) {
      impededCount++;
    }
  });
  
  document.getElementById('stat-total-parked').innerText = totalParked;
  document.getElementById('stat-total-occupied').innerText = totalOccupied;
  document.getElementById('stat-total-impeded').innerText = impededCount;
}

// ==========================================================================
// Audit Sidebar / Bottom Sheet Form Handler
// ==========================================================================

function selectZone(zone) {
  // If we are selecting the same zone that is already selected, do nothing
  if (state.selectedZone && state.selectedZone.name === zone.name) {
    return true;
  }

  // Check for unsaved changes in the currently selected zone
  if (state.selectedZone && state.formIsDirty) {
    playAlarmSound();
    
    // Scroll to the Save button
    const saveBtn = document.getElementById('btn-save-audit');
    if (saveBtn) {
      saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    const proceed = confirm(`WARNING: You have unsaved changes in EPark Zone ${state.selectedZone.name}. Do you want to proceed to Zone ${zone.name} without saving?`);
    if (!proceed) {
      // Restore map highlighting back to the current selectedZone
      zonesGroup.eachLayer(layer => {
        if (layer.options.zoneName === state.selectedZone.name) {
          layer.setStyle({
            weight: 3.5,
            color: '#0081BC'
          });
          layer.bringToFront();
        } else {
          layer.setStyle(getZoneStyle(layer.options.zoneName));
        }
      });
      return false;
    }
  }

  // Reset dirty flag for the new zone selection
  state.formIsDirty = false;
  state.selectedZone = zone;
  
  // Update text values
  document.getElementById('form-zone-id').innerText = zone.name;
  const headerZoneId = document.getElementById('header-zone-id');
  if (headerZoneId) {
    headerZoneId.innerText = `- ZONE ${zone.name}`;
  }
  document.getElementById('form-expected-stalls').innerText = zone.stalls || "N/A";
  document.getElementById('form-hours').innerHTML = zone.description.split('<br><br>')[0] || "See map info";
  document.getElementById('form-region').innerText = zone.region;
  document.getElementById('form-bia').innerText = zone.bia;
  
  // Reset form inputs to saved state or default
  const saved = state.audits[zone.name];
  if (saved) {
    document.getElementById('chk-sign-matches').checked = saved.signMatches === true;
    document.getElementById('input-parked-cars').value = saved.carsParked || 0;
    document.getElementById('input-occupied-cars').value = saved.driverOccupied || 0;
    document.getElementById('textarea-notes').value = saved.notes || "";
    
    // Checkboxes
    document.querySelectorAll('.chk-impediment').forEach(chk => {
      chk.checked = saved.impeded && saved.impeded.includes(chk.value);
    });
    
    // Other write-in box
    if (saved.impeded && saved.impeded.includes('other')) {
      document.getElementById('input-impediment-other-txt').classList.remove('hidden');
      document.getElementById('input-impediment-other-txt').value = saved.impededOtherText || "";
    } else {
      document.getElementById('input-impediment-other-txt').classList.add('hidden');
      document.getElementById('input-impediment-other-txt').value = "";
    }
    
    document.getElementById('btn-clear-zone').classList.remove('hidden');
  } else {
    // Defaults
    document.getElementById('chk-sign-matches').checked = false;
    document.getElementById('input-parked-cars').value = 0;
    document.getElementById('input-occupied-cars').value = 0;
    document.getElementById('textarea-notes').value = "";
    document.querySelectorAll('.chk-impediment').forEach(chk => chk.checked = false);
    document.getElementById('input-impediment-other-txt').classList.add('hidden');
    document.getElementById('input-impediment-other-txt').value = "";
    document.getElementById('btn-clear-zone').classList.add('hidden');
  }
  
  // Toggle Visibility in Stacked Form Pane
  document.getElementById('form-placeholder').classList.add('hidden');
  document.getElementById('form-content').classList.remove('hidden');
  
  // Highlight polygon on map
  zonesGroup.eachLayer(layer => {
    if (layer.options.zoneName === zone.name) {
      layer.setStyle({
        weight: 3.5,
        color: '#0081BC' // highlight color
      });
      layer.bringToFront();
    } else {
      // Restore standard styles
      layer.setStyle(getZoneStyle(layer.options.zoneName));
    }
  });
  
  return true;
}

function closeSidebar() {
  state.selectedZone = null;
  state.formIsDirty = false;
  
  const headerZoneId = document.getElementById('header-zone-id');
  if (headerZoneId) {
    headerZoneId.innerText = '';
  }
  
  // Toggle Visibility in Stacked Form Pane
  document.getElementById('form-placeholder').classList.remove('hidden');
  document.getElementById('form-content').classList.add('hidden');
  
  // Restore map styles
  zonesGroup.eachLayer(layer => {
    layer.setStyle(getZoneStyle(layer.options.zoneName));
  });
}

// ==========================================================================
// Geolocation Tracking & Geofencing
// ==========================================================================

function handleLocationUpdate(position) {
  const lat = position.coords.latitude;
  const lng = position.coords.longitude;
  const accuracy = position.coords.accuracy;
  state.currentLocation = [lat, lng];
  
  // Update location marker on map
  if (!locationMarker) {
    locationMarker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'gps-pulse-icon',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      })
    }).addTo(map);
    locationCircle = L.circle([lat, lng], {
      radius: accuracy,
      color: '#2196F3',
      fillColor: '#2196F3',
      fillOpacity: 0.15,
      weight: 1
    }).addTo(map);
  } else {
    locationMarker.setLatLng([lat, lng]);
    locationCircle.setLatLng([lat, lng]);
    locationCircle.setRadius(accuracy);
  }
  
  // Run Point-In-Polygon Geofencing Checks against EPark Zones
  let currentZoneInside = null;
  for (let i = 0; i < processedZones.length; i++) {
    const zone = processedZones[i];
    if (zone.geometry && isPointInPolygon(state.currentLocation, zone.geometry.coordinates)) {
      currentZoneInside = zone;
      break;
    }
  }
  
  // Trigger entry/exit events
  if (currentZoneInside) {
    if (state.insideZoneId !== currentZoneInside.name) {
      // Try to select the new zone first; abort if the user cancels due to unsaved changes
      const selected = selectZone(currentZoneInside);
      if (selected) {
        state.insideZoneId = currentZoneInside.name;
        playBellChime();
        showToast(`Walked into EPark Zone ${currentZoneInside.name}`, "success");
        map.setView(state.currentLocation, 18); // Zoom in close on entry
      }
    }
  } else {
    if (state.insideZoneId !== null) {
      const leftZoneId = state.insideZoneId;
      state.insideZoneId = null;
      showToast(`Walked out of EPark Zone ${leftZoneId}`, "warning");
      
      // Check if they left the zone that is currently loaded in the form with unsaved modifications
      if (state.selectedZone && state.selectedZone.name === leftZoneId && state.formIsDirty) {
        playAlarmSound();
        const saveBtn = document.getElementById('btn-save-audit');
        if (saveBtn) {
          saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        alert(`WARNING: You have left EPark Zone ${leftZoneId} with unsaved changes. Please save your data.`);
      }
    }
  }
}

function handleLocationError(error) {
  console.error("GPS location error:", error);
  showToast("Could not retrieve GPS coordinates. Ensure Location is enabled.", "error");
  state.gpsActive = false;
  document.getElementById('btn-locate').classList.remove('btn-primary');
  document.getElementById('btn-locate').classList.add('btn-secondary');
}

function toggleGPS() {
  if (state.gpsActive) {
    // Disable GPS
    state.gpsActive = false;
    document.getElementById('btn-locate').classList.remove('btn-primary');
    document.getElementById('btn-locate').classList.add('btn-secondary');
    showToast("GPS Tracking Disabled");
  } else {
    // Enable GPS
    if ("geolocation" in navigator) {
      state.gpsActive = true;
      document.getElementById('btn-locate').classList.add('btn-primary');
      document.getElementById('btn-locate').classList.remove('btn-secondary');
      
      navigator.geolocation.getCurrentPosition(position => {
        handleLocationUpdate(position);
        map.setView(state.currentLocation, 17);
        
        // Watch for position updates
        navigator.geolocation.watchPosition(handleLocationUpdate, handleLocationError, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
        showToast("GPS Geofencing Active");
      }, handleLocationError);
    } else {
      showToast("Geolocation is not supported by your browser.", "error");
    }
  }
}

// ==========================================================================
// Chart.js Visualizations
// ==========================================================================

function drawAnalyticsCharts() {
  const completedKeys = Object.keys(state.audits);
  
  if (completedKeys.length === 0) {
    // Hide canvas and show placeholder
    document.getElementById('chart-cars-per-zone').classList.add('hidden');
    document.getElementById('no-chart-data-1').classList.remove('hidden');
    document.getElementById('chart-impediments').classList.add('hidden');
    document.getElementById('no-chart-data-2').classList.remove('hidden');
    document.getElementById('table-container').classList.add('hidden');
    document.getElementById('no-table-data').classList.remove('hidden');
    return;
  }
  
  // Show elements
  document.getElementById('chart-cars-per-zone').classList.remove('hidden');
  document.getElementById('no-chart-data-1').classList.add('hidden');
  document.getElementById('chart-impediments').classList.remove('hidden');
  document.getElementById('no-chart-data-2').classList.add('hidden');
  document.getElementById('table-container').classList.remove('hidden');
  document.getElementById('no-table-data').classList.add('hidden');
  
  // Destroy old charts if they exist
  if (chartCars) chartCars.destroy();
  if (chartImpediments) chartImpediments.destroy();
  
  // Gather Data for Chart 1 (Counts per Zone)
  const labels = [];
  const parkedData = [];
  const occupiedData = [];
  
  // Sort keys alphabetically so zones list in order
  completedKeys.sort().forEach(key => {
    labels.push(key);
    parkedData.push(state.audits[key].carsParked);
    occupiedData.push(state.audits[key].driverOccupied);
  });
  
  const ctxCars = document.getElementById('chart-cars-per-zone').getContext('2d');
  chartCars = new Chart(ctxCars, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Total Parked Cars',
          data: parkedData,
          backgroundColor: '#005087', // Primary Brand Blue
          borderColor: '#193A5A',
          borderWidth: 1
        },
        {
          label: 'Cars with Drivers',
          data: occupiedData,
          backgroundColor: '#0081BC', // Accent Light Blue
          borderColor: '#005087',
          borderWidth: 1
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { font: { family: 'Open Sans', weight: '600' } }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Number of Cars', font: { family: 'Open Sans', weight: '700' } }
        },
        x: {
          title: { display: true, text: 'EPark Zone Number', font: { family: 'Open Sans', weight: '700' } }
        }
      }
    }
  });
  
  // Gather Data for Chart 2 (Impediments breakdown)
  let constructionTally = 0;
  let detourTally = 0;
  let epsTally = 0;
  let cityVehiclesTally = 0;
  let otherTally = 0;
  
  completedKeys.forEach(key => {
    const audit = state.audits[key];
    if (audit.impeded) {
      if (audit.impeded.includes('construction')) constructionTally++;
      if (audit.impeded.includes('detour')) detourTally++;
      if (audit.impeded.includes('eps')) epsTally++;
      if (audit.impeded.includes('city_vehicles')) cityVehiclesTally++;
      if (audit.impeded.includes('other')) otherTally++;
    }
  });
  
  const ctxImpediments = document.getElementById('chart-impediments').getContext('2d');
  chartImpediments = new Chart(ctxImpediments, {
    type: 'bar',
    data: {
      labels: ['Construction', 'Traffic Detours', 'EPS', 'City Vehicles', 'Other'],
      datasets: [{
        label: 'Impeded Zones',
        data: [constructionTally, detourTally, epsTally, cityVehiclesTally, otherTally],
        backgroundColor: [
          '#d84315', // warm warnings
          '#f57c00',
          '#193A5A', // dark blue for EPS
          '#0081BC',
          '#78909c'
        ],
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y', // Horizontal bar chart
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false } // Legend is redundant for single-dataset horizontal bars
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1 },
          title: { display: true, text: 'Number of Zones blocked', font: { family: 'Open Sans', weight: '700' } }
        }
      }
    }
  });
  
  // Populate Summary Data Table
  const tbody = document.getElementById('audit-log-tbody');
  tbody.innerHTML = ''; // Clear
  
  completedKeys.forEach(key => {
    const audit = state.audits[key];
    const zoneInfo = processedZones.find(z => z.name === key) || {};
    
    const tr = document.createElement('tr');
    
    // Format impediments
    let impedTxt = 'None';
    if (audit.impeded && audit.impeded.length > 0) {
      const parts = [];
      if (audit.impeded.includes('construction')) parts.push('Construction');
      if (audit.impeded.includes('detour')) parts.push('Detour');
      if (audit.impeded.includes('eps')) parts.push('EPS');
      if (audit.impeded.includes('city_vehicles')) parts.push('City Veh');
      if (audit.impeded.includes('other') && audit.impededOtherText) parts.push(`Other: ${audit.impededOtherText}`);
      else if (audit.impeded.includes('other')) parts.push('Other');
      
      impedTxt = `<span class="badge badge-danger">${parts.join(', ')}</span>`;
    }
    
    const signMatchBadge = audit.signMatches 
      ? '<span class="badge badge-success">Match</span>' 
      : '<span class="badge badge-warning">No Match</span>';
      
    tr.innerHTML = `
      <td><strong>${key}</strong></td>
      <td>${zoneInfo.region || 'None'}</td>
      <td>${zoneInfo.bia || 'None'}</td>
      <td>${zoneInfo.stalls || 'N/A'}</td>
      <td>${audit.carsParked}</td>
      <td>${audit.driverOccupied}</td>
      <td>${signMatchBadge}</td>
      <td>${impedTxt}</td>
      <td>${new Date(audit.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ==========================================================================
// Map Filters
// ==========================================================================

function applyMapFilter() {
  const query = state.searchQuery.toLowerCase().trim();
  const filter = state.filterStatus;
  
  zonesGroup.eachLayer(layer => {
    const zoneName = layer.options.zoneName;
    const audit = state.audits[zoneName];
    const zoneObj = processedZones.find(z => z.name === zoneName);
    
    let matchesSearch = true;
    if (query !== '') {
      matchesSearch = zoneName.toLowerCase().includes(query);
    }
    
    let matchesStatus = true;
    if (filter === 'pending') {
      matchesStatus = !audit;
    } else if (filter === 'completed') {
      matchesStatus = !!audit;
    } else if (filter === 'impeded') {
      matchesStatus = audit && audit.impeded && audit.impeded.length > 0;
    }
    
    if (matchesSearch && matchesStatus) {
      layer.addTo(map);
    } else {
      layer.removeFrom(map);
    }
  });
}

// ==========================================================================
// Exports: CSV and JSON
// ==========================================================================

function exportCSV() {
  const keys = Object.keys(state.audits);
  if (keys.length === 0) {
    showToast("No audit records available to export.", "error");
    return;
  }
  
  // CSV Headers
  let csvContent = "data:text/csv;charset=utf-8,";
  csvContent += "Zone ID,Expected Stalls,Rate,Parking Region,BIA,Cars Parked,Driver Occupied,Signage Details Match,Impediment Construction,Impediment Traffic Detours,Impediment EPS,Impediment City Vehicles,Impediment Other,Other Details,Field Notes,Audit Timestamp\n";
  
  keys.sort().forEach(key => {
    const audit = state.audits[key];
    const zone = processedZones.find(z => z.name === key) || {};
    
    const row = [
      key,
      zone.stalls || 0,
      `"${zone.rate || ''}"`,
      `"${zone.region || 'None'}"`,
      `"${zone.bia || 'None'}"`,
      audit.carsParked || 0,
      audit.driverOccupied || 0,
      audit.signMatches ? "TRUE" : "FALSE",
      audit.impeded.includes("construction") ? "TRUE" : "FALSE",
      audit.impeded.includes("detour") ? "TRUE" : "FALSE",
      audit.impeded.includes("eps") ? "TRUE" : "FALSE",
      audit.impeded.includes("city_vehicles") ? "TRUE" : "FALSE",
      audit.impeded.includes("other") ? "TRUE" : "FALSE",
      `"${audit.impededOtherText || ''}"`,
      `"${(audit.notes || '').replace(/"/g, '""')}"`,
      audit.timestamp
    ];
    
    csvContent += row.join(",") + "\n";
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `EPark_Audit_Report_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("CSV Exported successfully");
}

function exportJSON() {
  const keys = Object.keys(state.audits);
  if (keys.length === 0) {
    showToast("No audit records available to export.", "error");
    return;
  }
  
  // Format details including zone metadata
  const reportData = keys.sort().map(key => {
    const audit = state.audits[key];
    const zone = processedZones.find(z => z.name === key) || {};
    return {
      zoneId: key,
      metadata: {
        stalls: zone.stalls,
        rate: zone.rate,
        region: zone.region,
        bia: zone.bia
      },
      audit: audit
    };
  });
  
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(reportData, null, 2));
  const link = document.createElement("a");
  link.setAttribute("href", dataStr);
  link.setAttribute("download", `EPark_Audit_Data_${new Date().toISOString().split('T')[0]}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast("JSON Exported successfully");
}

function resetAuditData() {
  if (confirm("WARNING: Are you sure you want to delete ALL audit progress? This cannot be undone.")) {
    state.audits = {};
    saveAudits();
    closeSidebar();
    
    // Update map styling
    zonesGroup.eachLayer(layer => {
      layer.setStyle(getZoneStyle(layer.options.zoneName));
    });
    
    // Re-draw charts
    if (state.activeTab === 'analytics') {
      drawAnalyticsCharts();
    }
    
    showToast("Audit records successfully cleared", "success");
  }
}

// ==========================================================================
// Initialization & Event Listeners
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  // 1. Process Raw Geometries
  preprocessMapData();
  
  // 2. Load audits from localStorage
  loadAudits();
  updateStats();
  
  // Load UI scale preference from localStorage
  const savedScale = localStorage.getItem('epark_ui_scale');
  if (savedScale) {
    document.body.style.zoom = savedScale;
    const scaleSelect = document.getElementById('select-ui-scale');
    if (scaleSelect) {
      scaleSelect.value = savedScale;
    }
  }
  
  // 3. Initialize Map centered on Edmonton EPark core
  map = L.map('map', {
    center: [53.5435, -113.488],
    zoom: 15,
    layers: [tileLayers.voyager] // Light Voyager theme default
  });
  
  // Overlay Layer Groups
  zonesGroup = L.layerGroup().addTo(map);
  accessibleGroup = L.layerGroup();
  
  // Custom Base Map switching handler from top header dropdown
  const baseMapSelect = document.getElementById('select-base-map');
  if (baseMapSelect) {
    baseMapSelect.addEventListener('change', (e) => {
      const selectedTheme = e.target.value;
      
      // Remove all base tile layers
      map.removeLayer(tileLayers.voyager);
      map.removeLayer(tileLayers.dark);
      map.removeLayer(tileLayers.satellite);
      
      // Add the chosen base tile layer
      if (tileLayers[selectedTheme]) {
        map.addLayer(tileLayers[selectedTheme]);
      }
    });
  }

  // Custom Overlay Checkbox Handlers next to search box
  const chkToggleZones = document.getElementById('chk-toggle-zones');
  if (chkToggleZones) {
    chkToggleZones.addEventListener('change', (e) => {
      if (e.target.checked) {
        zonesGroup.addTo(map);
      } else {
        zonesGroup.removeFrom(map);
      }
    });
  }

  const chkToggleAccessible = document.getElementById('chk-toggle-accessible');
  if (chkToggleAccessible) {
    chkToggleAccessible.addEventListener('change', (e) => {
      if (e.target.checked) {
        accessibleGroup.addTo(map);
      } else {
        accessibleGroup.removeFrom(map);
      }
    });
  }
  
  // Render EPark Zones Polygons
  processedZones.forEach(zone => {
    if (zone.geometry && zone.geometry.type === "Polygon") {
      const polygon = L.polygon(zone.geometry.coordinates, getZoneStyle(zone.name));
      
      // Store reference properties inside Leaflet layer options
      polygon.options.zoneName = zone.name;
      
      // Map click handler to open sidebar
      polygon.on('click', () => {
        selectZone(zone);
      });
      
      // Bind simple hover tooltip
      polygon.bindTooltip(`Zone ${zone.name}`, { sticky: true, className: 'coe-map-tooltip' });
      polygon.addTo(zonesGroup);
    }
  });

  // Render Accessible Parking Pins
  const accessibleData = window.zonesData["Accessible Parking "] || [];
  accessibleData.forEach(item => {
    if (item.geometry && item.geometry.type === "Point") {
      const marker = L.circleMarker(item.geometry.coordinates, {
        radius: 6,
        fillColor: '#0081BC', // Accent blue
        color: '#FFFFFF',
        weight: 1.5,
        opacity: 1,
        fillOpacity: 0.85
      });
      marker.bindTooltip(`Accessible Parking: ${item.name}`, { sticky: true });
      marker.addTo(accessibleGroup);
    }
  });
  
  // ==========================================================================
  // Form Events (Increment / Decrement / Submission)
  // ==========================================================================
  
  // Counter +/- Increment buttons
  document.querySelectorAll('.counter-control button').forEach(button => {
    button.addEventListener('click', (e) => {
      const targetId = button.getAttribute('data-target');
      const input = document.getElementById(targetId);
      let val = parseInt(input.value) || 0;
      
      if (button.classList.contains('btn-counter-inc')) {
        val++;
      } else if (button.classList.contains('btn-counter-dec')) {
        if (val > 0) val--;
      }
      
      input.value = val;
      
      state.formIsDirty = true; // Mark form dirty on counter action
      
      // Validation check: Occupied can't exceed parked
      if (targetId === 'input-parked-cars') {
        const occupiedInput = document.getElementById('input-occupied-cars');
        const occupiedVal = parseInt(occupiedInput.value) || 0;
        if (occupiedVal > val) {
          occupiedInput.value = val;
        }
      } else if (targetId === 'input-occupied-cars') {
        const parkedVal = parseInt(document.getElementById('input-parked-cars').value) || 0;
        if (val > parkedVal) {
          input.value = parkedVal;
          showToast("Occupied cars cannot exceed total parked cars.", "error");
        }
      }
    });
  });
  
  // Impediment Other Checkbox Toggle write-in textbox
  document.getElementById('chk-impediment-other').addEventListener('change', (e) => {
    const otherTxt = document.getElementById('input-impediment-other-txt');
    if (e.target.checked) {
      otherTxt.classList.remove('hidden');
      otherTxt.focus();
    } else {
      otherTxt.classList.add('hidden');
      otherTxt.value = "";
    }
  });
  
  // Submit Audit Form
  document.getElementById('frm-audit').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.selectedZone) return;
    
    const zoneName = state.selectedZone.name;
    const parked = parseInt(document.getElementById('input-parked-cars').value) || 0;
    const occupied = parseInt(document.getElementById('input-occupied-cars').value) || 0;
    const notes = document.getElementById('textarea-notes').value;
    const signMatches = document.getElementById('chk-sign-matches').checked;
    
    // Validate occupied <= parked
    if (occupied > parked) {
      showToast("Occupied cars cannot exceed parked cars.", "error");
      return;
    }
    
    // Get Checked Impediments
    const impeded = [];
    document.querySelectorAll('.chk-impediment:checked').forEach(chk => {
      impeded.push(chk.value);
    });
    
    const otherText = document.getElementById('input-impediment-other-txt').value;
    
    // Save to state
    state.audits[zoneName] = {
      carsParked: parked,
      driverOccupied: occupied,
      impeded: impeded,
      impededOtherText: otherText,
      notes: notes,
      signMatches: signMatches,
      timestamp: new Date().toISOString()
    };
    
    // Save to localStorage
    saveAudits();
    
    state.formIsDirty = false; // Reset dirty status after successful save
    
    // Update color on map
    zonesGroup.eachLayer(layer => {
      if (layer.options.zoneName === zoneName) {
        layer.setStyle(getZoneStyle(zoneName));
      }
    });
    
    showToast(`Audit for Zone ${zoneName} saved successfully`, "success");
    closeSidebar();
  });
  
  // Clear Current Zone data
  document.getElementById('btn-clear-zone').addEventListener('click', () => {
    if (!state.selectedZone) return;
    const zoneName = state.selectedZone.name;
    
    if (confirm(`Clear all audit details for Zone ${zoneName}?`)) {
      delete state.audits[zoneName];
      saveAudits();
      
      state.formIsDirty = false; // Reset dirty status
      
      // Update color on map
      zonesGroup.eachLayer(layer => {
        if (layer.options.zoneName === zoneName) {
          layer.setStyle(getZoneStyle(zoneName));
        }
      });
      
      showToast(`Cleared audit details for Zone ${zoneName}`);
      closeSidebar();
    }
  });

  // Event Listeners to detect when the form inputs are modified (sign matching, text inputs, impediments)
  const formElement = document.getElementById('frm-audit');
  if (formElement) {
    const markAsDirty = () => { state.formIsDirty = true; };
    formElement.addEventListener('input', markAsDirty);
    formElement.addEventListener('change', markAsDirty);
  }
  const chkSign = document.getElementById('chk-sign-matches');
  if (chkSign) {
    chkSign.addEventListener('change', () => { state.formIsDirty = true; });
  }
  
  // Close Sidebar (if button exists)
  const closeBtn = document.getElementById('btn-close-sidebar');
  if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
  
  // ==========================================================================
  // Filter & Nav Events
  // ==========================================================================
  
  // Search bar input filter
  document.getElementById('search-zone').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    applyMapFilter();
    
    // Jump to zone on search if it matches exactly
    const match = processedZones.find(z => z.name === state.searchQuery.trim());
    if (match) {
      map.setView(match.centroid, 17);
      selectZone(match);
    }
  });
  
  // Status dropdown filter
  document.getElementById('filter-status').addEventListener('change', (e) => {
    state.filterStatus = e.target.value;
    applyMapFilter();
  });
  
  // Locate Me button (GPS locator toggle)
  document.getElementById('btn-locate').addEventListener('click', toggleGPS);
  
  // UI Scale Selector change handler
  const scaleSelect = document.getElementById('select-ui-scale');
  if (scaleSelect) {
    scaleSelect.addEventListener('change', (e) => {
      const selectedScale = e.target.value;
      document.body.style.zoom = selectedScale;
      localStorage.setItem('epark_ui_scale', selectedScale);
      
      // Delay invalidating size slightly to allow browser layout reflow
      setTimeout(() => {
        if (map) {
          map.invalidateSize();
        }
      }, 200);
      
      showToast(`UI Scale adjusted to ${Math.round(parseFloat(selectedScale) * 100)}%`);
    });
  }
  
  // Audio Tracker Toggle (User gesture activation)
  document.getElementById('btn-toggle-audio').addEventListener('click', () => {
    const btn = document.getElementById('btn-toggle-audio');
    
    if (state.audioEnabled) {
      state.audioEnabled = false;
      btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> Enable Audio Tracker';
      btn.className = "coe-btn btn-secondary";
      showToast("Audio Alerts disabled");
    } else {
      state.audioEnabled = true;
      btn.innerHTML = '<i class="fa-solid fa-volume-high"></i> Audio Tracker Active';
      btn.className = "coe-btn btn-primary";
      
      // Play a startup chime to authorize the Web Audio context immediately
      playBellChime();
      showToast("Audio Alerts active (Chime unlocked)");
    }
  });
  
  // Exporter bindings
  document.getElementById('btn-export-csv').addEventListener('click', (e) => {
    e.preventDefault();
    exportCSV();
  });
  
  document.getElementById('btn-export-json').addEventListener('click', (e) => {
    e.preventDefault();
    exportJSON();
  });
  
  document.getElementById('btn-reset-data').addEventListener('click', (e) => {
    e.preventDefault();
    resetAuditData();
  });
  
  // ==========================================================================
  // Navigation Tabs Switcher (Map vs Analytics)
  // ==========================================================================
  
  document.getElementById('tab-map').addEventListener('click', () => {
    state.activeTab = 'map';
    document.getElementById('tab-map').classList.add('active');
    document.getElementById('tab-analytics').classList.remove('active');
    
    document.getElementById('map-view-container').classList.add('active');
    document.getElementById('analytics-view-container').classList.remove('active');
    
    // Show map-specific controls in header and filter bar
    document.getElementById('header-base-maps').classList.remove('hidden');
    document.getElementById('filter-overlay-toggles').classList.remove('hidden');
    
    // Invalidate map size to prevent visual sizing bugs when shifting views
    setTimeout(() => {
      map.invalidateSize();
    }, 100);
  });
  
  document.getElementById('tab-analytics').addEventListener('click', () => {
    // Prompt warning for unsaved changes before switching views
    if (state.selectedZone && state.formIsDirty) {
      playAlarmSound();
      const saveBtn = document.getElementById('btn-save-audit');
      if (saveBtn) {
        saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const proceed = confirm(`WARNING: You have unsaved changes in EPark Zone ${state.selectedZone.name}. Do you want to switch tabs and discard these changes?`);
      if (!proceed) {
        return;
      }
    }

    state.activeTab = 'analytics';
    document.getElementById('tab-map').classList.remove('active');
    document.getElementById('tab-analytics').classList.add('active');
    
    document.getElementById('map-view-container').classList.remove('active');
    document.getElementById('analytics-view-container').classList.add('active');
    
    // Hide map-specific controls in header and filter bar
    document.getElementById('header-base-maps').classList.add('hidden');
    document.getElementById('filter-overlay-toggles').classList.add('hidden');
    
    closeSidebar();
    
    // Draw analytics charts in real-time
    drawAnalyticsCharts();
  });
});
