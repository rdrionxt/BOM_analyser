/**
 * Turnkey PCBA Studio - Client Application Logic
 * State management, interactive 2D canvas, real-time cost calculation,
 * BOM sourcing, supplier price comparisons, and Excel exports.
 */

// Global State
const state = {
  currency: 'INR',
  currencySymbol: '₹',
  usdRate: 83.5,

  // Pad Count Source: 'gerber' (RS-274X Gerber), 'bom' (BOM Pad Calculator), or 'manual' (Custom User Input)
  padSource: 'gerber',

  // Gerber State
  gerber: {
    loaded: false,
    filename: '',
    layerCount: 4,
    widthMm: 281.0,
    heightMm: 172.8,
    areaCm2: 485.6,
    areaSqIn: 75.3,
    smdTop: 1317,
    smdBot: 0,
    smdTotal: 1317,
    thtPins: 178,
    vias: 709,
    npthHoles: 28,
    totalPads: 1495,
    isDoubleSided: false,
    density: 2.7,
    complexityScore: 80.0,
    complexityLevel: 'Extreme (High-Density BGA / Micro-Pitch)',
    complexityColor: '#d500f9',
    detectedPackages: [],
    factors: [],
    manufacturingNotes: [],
    canvasGeometry: null
  },

  // Assembly Calculation State
  assembly: {
    numBoards: 10,
    costPerPad: 0.35,
    type: 'prototype', // 'prototype' or 'production'
    stencil: 'single', // 'single' or 'double'
    totalCost: 0,
    unitCost: 0,
    smdCost: 0,
    thtCost: 0,
    stencilCost: 800,
    setupCost: 1200,
    complexitySurcharge: 0,
    volumeDiscountPct: 0
  },

  // BOM State
  bom: {
    loaded: false,
    filename: '',
    rawItems: [],
    sourcedItems: [],
    preferredKeywords: ['sunrom', 'electronicscomp', 'robu'],
    totalLineItems: 0,
    totalComponents: 0,
    totalBomCost: 0.0,
    isSourcing: false
  },

  // BOM Pad Calculator State
  bomPads: {
    loaded: false,
    smdPads: 0,
    thtPins: 0,
    totalPads: 0,
    resolvedCount: 0,
    unresolvedCount: 0,
    resolutionPct: 100,
    complexityScore: 50.0,
    unresolvedItems: [],
    manualOverrides: {} // id -> { pads_per_unit, pad_type }
  },

  // Backend Connection State
  backend: {
    baseUrl: localStorage.getItem('circuit_iq_backend_url') || '',
    status: 'checking', // 'online', 'standalone', 'offline'
    isOnline: false
  },

  // Canvas Viewport State (Zoom, Pan, Layer Toggles, Themes)
  canvas: {
    scale: 1.0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    layers: {
      outline: true,
      silk: true,
      pads: true,
      copper: true,
      drills: true
    },
    maskTheme: 'green',
    padFinish: 'enig',
    side: 'top',
    hoveredItem: null
  }
};

// ==================== INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', () => {
  setupDropzones();
  setupCanvasInteractions();
  checkBackendHealth();
  // Auto-load sample gerber & bom on initial load for instant wow experience
  loadSampleGerber();
  loadSampleBom();
});

// Helper: build API URL with custom backend base if configured
function getApiUrl(endpoint) {
  if (state.backend.baseUrl) {
    return `${state.backend.baseUrl.replace(/\/$/, '')}${endpoint}`;
  }
  return endpoint;
}

// Check Backend Health & update header indicator
async function checkBackendHealth() {
  const dot = document.getElementById('statusDot');
  const text = document.getElementById('backendStatusText');
  const modalDot = document.getElementById('modalStatusDot');
  const modalTitle = document.getElementById('modalEngineStatusTitle');
  const modalSub = document.getElementById('modalEngineStatusSub');

  try {
    const healthUrl = getApiUrl('/api/health');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(healthUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      state.backend.isOnline = true;
      state.backend.status = 'online';
      if (dot) dot.className = 'status-dot online';
      if (text) text.innerText = state.backend.baseUrl ? 'Cloud Backend' : 'Engine: Local';
      if (modalDot) modalDot.className = 'status-dot online';
      if (modalTitle) modalTitle.innerText = 'Connected to Backend Engine';
      if (modalSub) modalSub.innerText = `Active API: ${healthUrl}`;
      return;
    }
  } catch (err) {
    // Backend offline / not reachable
  }

  state.backend.isOnline = false;
  state.backend.status = 'standalone';
  if (dot) dot.className = 'status-dot standalone';
  if (text) text.innerText = 'Engine: Client';
  if (modalDot) modalDot.className = 'status-dot standalone';
  if (modalTitle) modalTitle.innerText = 'Standalone Browser Engine';
  if (modalSub) modalSub.innerText = 'Running client-side offline engine (BOM parsing & pad calculator active).';
}


// ==================== TAB NAVIGATION ====================
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(panel => panel.classList.remove('active'));

  if (tabId === 'gerber') {
    document.getElementById('tabBtnGerber').classList.add('active');
    document.getElementById('tabGerber').classList.add('active');
    if (state.gerber.canvasGeometry) {
      setTimeout(renderCanvas, 50);
    }
  } else if (tabId === 'bom') {
    document.getElementById('tabBtnBom').classList.add('active');
    document.getElementById('tabBom').classList.add('active');
  } else if (tabId === 'turnkey') {
    document.getElementById('tabBtnTurnkey').classList.add('active');
    document.getElementById('tabTurnkey').classList.add('active');
    updateTurnkeySummary();
  }
}

// ==================== CURRENCY & THEME ====================
function toggleCurrency() {
  if (state.currency === 'INR') {
    state.currency = 'USD';
    state.currencySymbol = '$';
    state.assembly.costPerPad = parseFloat((state.assembly.costPerPad / state.usdRate).toFixed(4));
  } else {
    state.currency = 'INR';
    state.currencySymbol = '₹';
    state.assembly.costPerPad = parseFloat((state.assembly.costPerPad * state.usdRate).toFixed(2));
  }

  document.getElementById('currencySymbolText').innerText = state.currencySymbol;
  document.getElementById('currencyCodeText').innerText = state.currency;
  document.querySelectorAll('.currency-symbol-label').forEach(el => el.innerText = state.currencySymbol);

  document.getElementById('costPerPadInput').value = state.assembly.costPerPad;

  recalcAssemblyCost();
  if (state.bom.sourcedItems.length > 0) {
    // Re-source with new currency
    startSourcingBOM();
  }
  updateTurnkeySummary();
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  if (state.gerber.canvasGeometry) {
    renderCanvas();
  }
}

function showToast(message) {
  const toast = document.getElementById('toastNotification');
  document.getElementById('toastMessage').innerText = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 3200);
}

// ==================== DROPZONE & FILE UPLOAD ====================
function setupDropzones() {
  // Gerber Dropzone
  const gerberDz = document.getElementById('gerberDropzone');
  const gerberInput = document.getElementById('gerberFileInput');

  gerberDz.addEventListener('dragover', (e) => {
    e.preventDefault();
    gerberDz.classList.add('dragover');
  });
  gerberDz.addEventListener('dragleave', () => gerberDz.classList.remove('dragover'));
  gerberDz.addEventListener('drop', (e) => {
    e.preventDefault();
    gerberDz.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadGerberFile(e.dataTransfer.files[0]);
    }
  });
  gerberInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadGerberFile(e.target.files[0]);
    }
  });

  // BOM Dropzone
  const bomDz = document.getElementById('bomDropzone');
  const bomInput = document.getElementById('bomFileInput');

  bomDz.addEventListener('dragover', (e) => {
    e.preventDefault();
    bomDz.classList.add('dragover');
  });
  bomDz.addEventListener('dragleave', () => bomDz.classList.remove('dragover'));
  bomDz.addEventListener('drop', (e) => {
    e.preventDefault();
    bomDz.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      uploadBomFile(e.dataTransfer.files[0]);
    }
  });
  bomInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadBomFile(e.target.files[0]);
    }
  });
}

// ==================== GERBER ACTIONS & ANALYZER ====================
async function uploadGerberFile(file) {
  document.getElementById('gerberStatusTitle').innerText = 'Analyzing Gerber RS-274X...';
  document.getElementById('gerberStatusSub').innerText = file.name;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/analyze-gerber', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok) {
      applyGerberData(data);
      showToast('Gerber files analyzed successfully!');
    } else {
      alert('Error analyzing Gerber: ' + (data.detail || 'Unknown error'));
    }
  } catch (err) {
    alert('Upload error: ' + err.message);
  } finally {
    document.getElementById('gerberStatusTitle').innerText = 'Drop Gerber ZIP Archive Here';
    document.getElementById('gerberStatusSub').innerText = 'Supports KiCad, Altium, Eagle, EasyEDA Gerber RS-274X & Drills (.zip)';
  }
}

async function loadSampleGerber() {
  document.getElementById('gerberStatusTitle').innerText = 'Loading Sample AX60 Gerber...';
  try {
    const res = await fetch(getApiUrl('/api/sample-gerber'));
    if (res.ok) {
      const data = await res.json();
      applyGerberData(data);
      showToast('Sample Gerber (AX60 4-Layer) loaded!');
      return;
    }
  } catch (err) {
    console.warn('API /api/sample-gerber unavailable, falling back to embedded sample data:', err);
  } finally {
    document.getElementById('gerberStatusTitle').innerText = 'Drop Gerber ZIP Archive Here';
  }

  // Standalone offline fallback
  if (typeof SAMPLE_GERBER_DATA !== 'undefined' && SAMPLE_GERBER_DATA) {
    applyGerberData(SAMPLE_GERBER_DATA);
    showToast('Sample Gerber (AX60 4-Layer) loaded via Client Engine!');
  }
}

function applyGerberData(data) {
  state.gerber.loaded = true;
  state.gerber.filename = data.filename || 'Gerber_Archive.zip';
  state.gerber.layerCount = data.layer_count || 2;
  state.gerber.widthMm = data.dimensions?.width_mm || 100;
  state.gerber.heightMm = data.dimensions?.height_mm || 80;
  state.gerber.areaCm2 = data.dimensions?.area_cm2 || 80;
  state.gerber.areaSqIn = data.dimensions?.area_sq_in || 12.4;

  state.gerber.smdTop = data.pads?.smd_top || 0;
  state.gerber.smdBot = data.pads?.smd_bottom || 0;
  state.gerber.smdTotal = data.pads?.smd_total || 0;
  state.gerber.thtPins = data.pads?.tht_pins || 0;
  state.gerber.vias = data.pads?.vias || 0;
  state.gerber.npthHoles = data.pads?.npth_holes || 0;
  state.gerber.totalPads = data.pads?.total_pads || (state.gerber.smdTotal + state.gerber.thtPins);
  state.gerber.isDoubleSided = data.pads?.is_double_sided || false;
  state.gerber.density = data.complexity?.density_pads_per_cm2 || 0;

  state.gerber.complexityScore = data.complexity?.score || 50.0;
  state.gerber.complexityLevel = data.complexity?.level || 'Moderate';
  state.gerber.complexityColor = data.complexity?.color || '#ffab00';
  state.gerber.detectedPackages = data.complexity?.detected_packages || [];
  state.gerber.factors = data.complexity?.factors || [];
  state.gerber.manufacturingNotes = data.complexity?.manufacturing_notes || [];

  state.gerber.canvasGeometry = data.canvas_geometry || null;

  // Render to DOM
  document.getElementById('gerberActiveFileBanner').style.display = 'block';
  document.getElementById('activeGerberFilename').innerText = state.gerber.filename;

  const srcGerberBadge = document.getElementById('sourceGerberPadsBadge');
  if (srcGerberBadge) srcGerberBadge.innerText = state.gerber.totalPads.toLocaleString();

  document.getElementById('dispLayerCount').innerText = `${state.gerber.layerCount} Copper Layers`;
  document.getElementById('dispLayerDesc').innerText = `${state.gerber.layerCount >= 4 ? 'Multilayer High-Speed Stackup' : 'Double-Sided Standard FR4'}`;

  document.getElementById('dispTotalPads').innerText = `${state.gerber.totalPads.toLocaleString()} Pads`;
  document.getElementById('dispPadBreakdown').innerText = `SMD: ${state.gerber.smdTotal} | THT: ${state.gerber.thtPins} | Vias: ${state.gerber.vias}`;

  document.getElementById('dispDimensions').innerText = `${state.gerber.widthMm} × ${state.gerber.heightMm} mm`;
  document.getElementById('dispArea').innerText = `Area: ${state.gerber.areaCm2} cm² (${state.gerber.areaSqIn} sq in)`;

  const hudSize = document.getElementById('hudBoardSize');
  if (hudSize) {
    hudSize.innerText = `📐 ${state.gerber.widthMm} × ${state.gerber.heightMm} mm`;
  }

  document.getElementById('dispDensity').innerText = `${state.gerber.density} pads/cm²`;
  document.getElementById('dispSmtSides').innerText = state.gerber.isDoubleSided ? 'Double-Sided SMT (Top + Bot)' : 'Single-Sided SMT (Top Only)';

  // Update Complexity Radial Gauge
  document.getElementById('dispComplexityScore').innerText = `${state.gerber.complexityScore}%`;
  const badge = document.getElementById('dispComplexityBadge');
  badge.innerText = state.gerber.complexityLevel;
  badge.style.background = `${state.gerber.complexityColor}22`;
  badge.style.color = state.gerber.complexityColor;

  // Animate Gauge SVG stroke
  const circle = document.getElementById('gaugeCircle');
  const circumference = 2 * Math.PI * 70; // ~439.8
  const offset = circumference - (state.gerber.complexityScore / 100) * circumference;
  circle.style.stroke = state.gerber.complexityColor;
  circle.style.strokeDasharray = `${circumference}`;
  circle.style.strokeDashoffset = `${offset}`;

  // Package Chips
  const chipsContainer = document.getElementById('dispPackagesChips');
  chipsContainer.innerHTML = '';
  state.gerber.detectedPackages.forEach(pkg => {
    const chip = document.createElement('span');
    chip.className = 'package-chip highlight';
    chip.innerText = `🔍 ${pkg}`;
    chipsContainer.appendChild(chip);
  });

  // Factors List
  const factorsList = document.getElementById('dispFactorsList');
  factorsList.innerHTML = '';
  state.gerber.factors.forEach(fac => {
    const li = document.createElement('li');
    li.innerText = fac;
    factorsList.appendChild(li);
  });

  // Manufacturing Notes
  const notesList = document.getElementById('dispManufacturingNotes');
  notesList.innerHTML = '';
  state.gerber.manufacturingNotes.forEach(note => {
    const li = document.createElement('li');
    li.innerText = note;
    notesList.appendChild(li);
  });

  // Stencil dropdown auto-selection based on double-sided detection
  const stencilSelect = document.getElementById('stencilSelect');
  if (state.gerber.isDoubleSided) {
    stencilSelect.value = 'double';
  } else {
    stencilSelect.value = 'single';
  }

  // Recalculate Assembly Cost
  recalcAssemblyCost();

  // Render Canvas
  renderCanvas();
}

// ==================== ASSEMBLY COST CALCULATOR & PAD SOURCE ====================
function setPadSource(source) {
  state.padSource = source;
  const btnGerber = document.getElementById('btnSourceGerber');
  const btnBom = document.getElementById('btnSourceBom');
  const btnManual = document.getElementById('btnSourceManual');
  if (btnGerber) btnGerber.classList.toggle('active', source === 'gerber');
  if (btnBom) btnBom.classList.toggle('active', source === 'bom');
  if (btnManual) btnManual.classList.toggle('active', source === 'manual');

  const manualRow = document.getElementById('manualPadsRow');
  const badge = document.getElementById('activePadSourceBadge');
  const exp = document.getElementById('sourceExplanationText');

  if (source === 'gerber') {
    if (manualRow) manualRow.style.display = 'none';
    if (badge) badge.innerText = '📐 Gerber RS-274X';
    if (exp) exp.innerText = `Source: RS-274X Gerber Solder Paste (${state.gerber.smdTotal} SMD pads) + Drill Hits (${state.gerber.thtPins} THT pins).`;
  } else if (source === 'bom') {
    if (manualRow) manualRow.style.display = 'none';
    if (badge) badge.innerText = '📋 BOM Pad Calculator';
    if (exp) exp.innerText = `Source: BOM Component Footprints (${state.bomPads.smdPads} SMD pads, ${state.bomPads.thtPins} THT pins across ${state.bom.totalComponents} parts).`;
  } else if (source === 'manual') {
    if (manualRow) manualRow.style.display = 'flex';
    if (badge) badge.innerText = '✏️ Custom Manual';
    if (exp) exp.innerText = 'Source: Custom user-defined pad counts.';
  }

  recalcAssemblyCost();
  updateTurnkeySummary();
}

function onCustomPadsChange() {
  if (state.padSource === 'manual') {
    recalcAssemblyCost();
    updateTurnkeySummary();
  }
}

function applyBomPadsToAssembly() {
  setPadSource('bom');
  switchTab('gerber');
  const calcPanel = document.querySelector('.cost-calculator-panel');
  if (calcPanel) {
    calcPanel.scrollIntoView({ behavior: 'smooth' });
  }
  showToast(`Applied BOM pads (${state.bomPads.smdPads} SMD + ${state.bomPads.thtPins} THT) to Assembly Cost!`);
}

function setBoardQty(qty) {
  document.getElementById('numBoardsInput').value = qty;
  document.querySelectorAll('.preset-pills .pill-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.innerText) === qty);
  });
  recalcAssemblyCost();
  updateTurnkeySummary();
}

function setAssemblyType(type) {
  state.assembly.type = type;
  document.getElementById('btnTypePrototype').classList.toggle('active', type === 'prototype');
  document.getElementById('btnTypeProduction').classList.toggle('active', type === 'production');

  const exp = document.getElementById('typeExplanationText');
  if (type === 'production') {
    exp.innerText = 'Production Batch: High-speed pick-and-place, amortized stencil, volume discounts up to 50%.';
  } else {
    exp.innerText = 'Prototype: Individual setup, manual optical inspection. Base pad rates.';
  }

  recalcAssemblyCost();
  updateTurnkeySummary();
}

function calculateAssemblyCostClient(p) {
  const usdRate = p.currency === 'USD' ? state.usdRate : 1.0;
  const qty = Math.max(1, p.num_boards);
  const baseRate = p.cost_per_pad;

  let volMultiplier = 1.0;
  if (p.assembly_type.toLowerCase() === 'production') {
    if (qty >= 1000) volMultiplier = 0.50;
    else if (qty >= 500) volMultiplier = 0.65;
    else if (qty >= 100) volMultiplier = 0.80;
    else if (qty >= 50) volMultiplier = 0.90;
  }

  const smdRate = baseRate * volMultiplier;
  const thtRate = smdRate * 2.5;

  const totalSmdCost = parseFloat((p.smd_pads * smdRate * qty).toFixed(2));
  const totalThtCost = parseFloat((p.tht_pads * thtRate * qty).toFixed(2));
  const placementSubtotal = totalSmdCost + totalThtCost;

  const stencilFee = (p.is_double_sided ? 1500.0 : 800.0) / usdRate;
  const setupFee = (p.assembly_type.toLowerCase() === 'prototype' ? 1200.0 : 2200.0) / usdRate;

  const compMultiplier = 1.0 + (p.complexity_score / 100.0) * 0.45;
  const compSurcharge = parseFloat((placementSubtotal * (compMultiplier - 1.0)).toFixed(2));

  const totalAssemblyCost = parseFloat((placementSubtotal + compSurcharge + stencilFee + setupFee).toFixed(2));
  const costPerBoard = parseFloat((totalAssemblyCost / qty).toFixed(2));

  return {
    num_boards: qty,
    assembly_type: p.assembly_type,
    currency: p.currency,
    currency_symbol: state.currencySymbol,
    cost_per_pad_input: baseRate,
    effective_smt_pad_rate: parseFloat(smdRate.toFixed(4)),
    effective_tht_pin_rate: parseFloat(thtRate.toFixed(4)),
    volume_discount_pct: parseFloat(((1.0 - volMultiplier) * 100).toFixed(1)),
    smd_pads_per_board: p.smd_pads,
    tht_pads_per_board: p.tht_pads,
    total_pads_per_board: p.smd_pads + p.tht_pads,
    total_smt_cost: totalSmdCost,
    total_tht_cost: totalThtCost,
    stencil_fee: parseFloat(stencilFee.toFixed(2)),
    setup_fee: parseFloat(setupFee.toFixed(2)),
    complexity_score: p.complexity_score,
    complexity_multiplier: parseFloat(compMultiplier.toFixed(3)),
    complexity_surcharge: compSurcharge,
    total_assembly_cost: totalAssemblyCost,
    cost_per_board: costPerBoard
  };
}

async function recalcAssemblyCost() {
  const numBoards = parseInt(document.getElementById('numBoardsInput').value) || 10;
  const costPerPad = parseFloat(document.getElementById('costPerPadInput').value) || 0.35;
  const stencil = document.getElementById('stencilSelect').value;
  const isDouble = stencil === 'double';

  state.assembly.numBoards = numBoards;
  state.assembly.costPerPad = costPerPad;
  state.assembly.stencil = stencil;

  let smdPads = 1317;
  let thtPads = 178;
  let compScore = 50.0;

  if (state.padSource === 'bom' && state.bomPads.loaded) {
    smdPads = state.bomPads.smdPads;
    thtPads = state.bomPads.thtPins;
    compScore = state.bomPads.complexityScore || 50.0;
  } else if (state.padSource === 'manual') {
    smdPads = parseInt(document.getElementById('customSmdPadsInput')?.value) || 0;
    thtPads = parseInt(document.getElementById('customThtPinsInput')?.value) || 0;
    compScore = state.gerber.complexityScore || 50.0;
  } else {
    smdPads = state.gerber.smdTotal || 1317;
    thtPads = state.gerber.thtPins || 178;
    compScore = state.gerber.complexityScore || 50.0;
  }

  const payload = {
    num_boards: numBoards,
    cost_per_pad: costPerPad,
    smd_pads: smdPads,
    tht_pads: thtPads,
    assembly_type: state.assembly.type,
    complexity_score: compScore,
    is_double_sided: isDouble,
    currency: state.currency
  };

  if (state.backend.isOnline) {
    try {
      const res = await fetch(getApiUrl('/api/calculate-assembly'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const data = await res.json();
        applyAssemblyResults(data);
        return;
      }
    } catch (err) {
      console.warn('Backend calculation endpoint unavailable, computing on client:', err);
    }
  }

  // Client-Side Calculation
  const clientResults = calculateAssemblyCostClient(payload);
  applyAssemblyResults(clientResults);
}

function applyAssemblyResults(data) {
  state.assembly.totalCost = data.total_assembly_cost;
  state.assembly.unitCost = data.cost_per_board;
  state.assembly.smdCost = data.total_smt_cost;
  state.assembly.thtCost = data.total_tht_cost;
  state.assembly.stencilCost = data.stencil_fee;
  state.assembly.setupCost = data.setup_fee;
  state.assembly.complexitySurcharge = data.complexity_surcharge;
  state.assembly.volumeDiscountPct = data.volume_discount_pct;

  const sym = state.currencySymbol;

  document.getElementById('dispTotalAssemblyCost').innerText = `${sym}${data.total_assembly_cost.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById('dispUnitAssemblyCost').innerText = `${sym}${data.cost_per_board.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} / board`;

  document.getElementById('calcSmdPadsCount').innerText = data.smd_pads_per_board;
  document.getElementById('calcBoardsQty').innerText = data.num_boards;
  document.getElementById('calcSmdCost').innerText = `${sym}${data.total_smt_cost.toFixed(2)}`;

  document.getElementById('calcThtCount').innerText = data.tht_pads_per_board;
  document.getElementById('calcThtCost').innerText = `${sym}${data.total_tht_cost.toFixed(2)}`;

  document.getElementById('calcStencilCost').innerText = `${sym}${data.stencil_fee.toFixed(2)}`;
  document.getElementById('calcSetupCost').innerText = `${sym}${data.setup_fee.toFixed(2)}`;

  document.getElementById('calcCompScore').innerText = `${data.complexity_score}% (${data.complexity_multiplier}x)`;
  document.getElementById('calcCompSurcharge').innerText = `+${sym}${data.complexity_surcharge.toFixed(2)}`;

  const discountRow = document.getElementById('volumeDiscountRow');
  if (data.volume_discount_pct > 0) {
    discountRow.style.display = 'table-row';
    document.getElementById('calcVolumeDiscount').innerText = `-${data.volume_discount_pct}% volume tier`;
  } else {
    discountRow.style.display = 'none';
  }

  updateTurnkeySummary();
}

// ==================== ADVANCED ENGINEERING PCB VISUALIZER ====================

// Soldermask Color Themes
const MASK_THEMES = {
  green: {
    substrate: '#0c2b1e',
    edge: '#16a34a',
    copperTrack: 'rgba(34, 197, 94, 0.28)',
    silk: '#f8fafc',
    grid: 'rgba(34, 197, 94, 0.05)'
  },
  black: {
    substrate: '#080c14',
    edge: '#475569',
    copperTrack: 'rgba(148, 163, 184, 0.25)',
    silk: '#f1f5f9',
    grid: 'rgba(255, 255, 255, 0.03)'
  },
  blue: {
    substrate: '#081d38',
    edge: '#2563eb',
    copperTrack: 'rgba(56, 189, 248, 0.28)',
    silk: '#f8fafc',
    grid: 'rgba(56, 189, 248, 0.05)'
  },
  red: {
    substrate: '#2d0a0a',
    edge: '#dc2626',
    copperTrack: 'rgba(248, 113, 113, 0.28)',
    silk: '#f8fafc',
    grid: 'rgba(239, 68, 68, 0.05)'
  },
  purple: {
    substrate: '#1c0729',
    edge: '#9333ea',
    copperTrack: 'rgba(192, 132, 252, 0.28)',
    silk: '#f8fafc',
    grid: 'rgba(168, 85, 247, 0.05)'
  },
  white: {
    substrate: '#cbd5e1',
    edge: '#64748b',
    copperTrack: 'rgba(71, 85, 105, 0.35)',
    silk: '#0f172a',
    grid: 'rgba(0, 0, 0, 0.05)'
  }
};

// Pad Surface Finishes (ENIG Gold vs HASL Silver)
const PAD_FINISHES = {
  enig: {
    fill: '#f59e0b',
    stroke: '#d97706',
    glow: 'rgba(245, 158, 11, 0.35)'
  },
  hasl: {
    fill: '#e2e8f0',
    stroke: '#94a3b8',
    glow: 'rgba(226, 232, 240, 0.3)'
  }
};

function toggleLayer(layerName, isChecked) {
  state.canvas.layers[layerName] = isChecked;
  const pill = document.getElementById('pill' + layerName.charAt(0).toUpperCase() + layerName.slice(1));
  if (pill) pill.classList.toggle('active', isChecked);
  renderCanvas();
}

function setSoldermaskColor(themeName) {
  state.canvas.maskTheme = themeName;
  renderCanvas();
}

function setPadFinish(finishName) {
  state.canvas.padFinish = finishName;
  renderCanvas();
}

function setBoardSide(side) {
  state.canvas.side = side;
  document.getElementById('btnSideTop').classList.toggle('active', side === 'top');
  document.getElementById('btnSideBot').classList.toggle('active', side === 'bot');
  const sideBadge = document.getElementById('hudSideBadge');
  if (sideBadge) {
    sideBadge.innerText = side === 'top' ? 'Top Layer (F.Cu / F.Paste)' : 'Bottom Layer (B.Cu / B.Paste)';
  }
  renderCanvas();
}

function setupCanvasInteractions() {
  const canvas = document.getElementById('pcbCanvas');
  const wrapper = document.getElementById('canvasWrapper');
  const tooltip = document.getElementById('canvasTooltip');
  const coordsHud = document.getElementById('hudCoords');

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Only primary button
    state.canvas.isDragging = true;
    wrapper.classList.add('grabbing');
    state.canvas.dragStartX = e.clientX - state.canvas.offsetX;
    state.canvas.dragStartY = e.clientY - state.canvas.offsetY;
  });

  window.addEventListener('mouseup', () => {
    if (state.canvas.isDragging) {
      state.canvas.isDragging = false;
      wrapper.classList.remove('grabbing');
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (state.canvas.isDragging) {
      state.canvas.offsetX = e.clientX - state.canvas.dragStartX;
      state.canvas.offsetY = e.clientY - state.canvas.dragStartY;
      renderCanvas();
    }

    // Inspect hover coordinates & element under mouse
    const geom = state.gerber.canvasGeometry;
    if (!geom || !geom.width || !geom.height) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const w = rect.width;
    const h = rect.height;
    const padding = 50;
    const availW = w - padding * 2;
    const availH = h - padding * 2;
    const baseScale = Math.min(availW / geom.width, availH / geom.height);

    const bW = geom.width * baseScale;
    const bH = geom.height * baseScale;
    const originX = -bW / 2;
    const originY = -bH / 2;

    const cx = (mx - (w / 2 + state.canvas.offsetX)) / state.canvas.scale;
    const cy = (my - (h / 2 + state.canvas.offsetY)) / state.canvas.scale;

    const boardX = (cx - originX) / baseScale;
    const boardY = geom.height - (cy - originY) / baseScale;

    if (coordsHud) {
      coordsHud.innerText = `X: ${Math.max(0, Math.min(geom.width, boardX)).toFixed(2)} mm | Y: ${Math.max(0, Math.min(geom.height, boardY)).toFixed(2)} mm`;
    }

    // Check hit on SMD pads
    let hitFound = null;
    if (state.canvas.layers.pads && geom.pads) {
      const activeSide = state.canvas.side;
      for (let i = 0; i < geom.pads.length; i++) {
        const p = geom.pads[i];
        if (p.side !== activeSide) continue;
        const halfW = (p.w || 1.0) / 2 + 0.3;
        const halfH = (p.h || 1.0) / 2 + 0.3;
        if (Math.abs(p.x - boardX) <= halfW && Math.abs(p.y - boardY) <= halfH) {
          hitFound = {
            type: 'pad',
            title: `SMD Pad (${activeSide === 'top' ? 'Top' : 'Bottom'})`,
            body: `${p.w} × ${p.h} mm [${p.shape.toUpperCase()}] Aperture: ${p.aperture || 'Auto'}`,
            coords: `X: ${p.x.toFixed(2)} mm, Y: ${p.y.toFixed(2)} mm`,
            item: p
          };
          break;
        }
      }
    }

    // Check hit on drill holes
    if (!hitFound && state.canvas.layers.drills && geom.drills) {
      for (let i = 0; i < geom.drills.length; i++) {
        const d = geom.drills[i];
        const dist = Math.hypot(d.x - boardX, d.y - boardY);
        if (dist <= (d.dia || 0.6) / 2 + 0.35) {
          hitFound = {
            type: 'drill',
            title: d.pth ? (d.is_via ? 'Plated Via (PTH)' : 'Through-Hole Pin (PTH)') : 'Mechanical Cutout (NPTH)',
            body: `Diameter: Ø ${d.dia} mm (${d.pth ? 'Plated Annular Ring' : 'Non-Plated Hole'})`,
            coords: `X: ${d.x.toFixed(2)} mm, Y: ${d.y.toFixed(2)} mm`,
            item: d
          };
          break;
        }
      }
    }

    if (hitFound && tooltip) {
      document.getElementById('ttTitle').innerText = hitFound.title;
      document.getElementById('ttBody').innerText = hitFound.body;
      document.getElementById('ttCoords').innerText = hitFound.coords;
      tooltip.style.left = mx + 'px';
      tooltip.style.top = my + 'px';
      tooltip.style.display = 'block';
      if (state.canvas.hoveredItem !== hitFound.item) {
        state.canvas.hoveredItem = hitFound.item;
        renderCanvas();
      }
    } else {
      if (tooltip) tooltip.style.display = 'none';
      if (state.canvas.hoveredItem !== null) {
        state.canvas.hoveredItem = null;
        renderCanvas();
      }
    }
  });

  canvas.addEventListener('mouseleave', () => {
    if (tooltip) tooltip.style.display = 'none';
    if (state.canvas.hoveredItem !== null) {
      state.canvas.hoveredItem = null;
      renderCanvas();
    }
  });

  // CAD Zoom centered on mouse cursor
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const prevScale = state.canvas.scale;
    const newScale = Math.max(0.3, Math.min(18.0, prevScale * factor));

    state.canvas.offsetX = mx - (mx - state.canvas.offsetX) * (newScale / prevScale);
    state.canvas.offsetY = my - (my - state.canvas.offsetY) * (newScale / prevScale);
    state.canvas.scale = newScale;

    renderCanvas();
  }, { passive: false });

  // Double click to fit
  canvas.addEventListener('dblclick', () => {
    fitCanvasToBoard();
  });

  window.addEventListener('resize', () => {
    if (state.gerber.canvasGeometry) {
      renderCanvas();
    }
  });
}

function zoomCanvas(factor) {
  const canvas = document.getElementById('pcbCanvas');
  const w = canvas.clientWidth || 900;
  const h = canvas.clientHeight || 520;
  const mx = w / 2;
  const my = h / 2;

  const prevScale = state.canvas.scale;
  const newScale = Math.max(0.3, Math.min(18.0, prevScale * factor));

  state.canvas.offsetX = mx - (mx - state.canvas.offsetX) * (newScale / prevScale);
  state.canvas.offsetY = my - (my - state.canvas.offsetY) * (newScale / prevScale);
  state.canvas.scale = newScale;

  renderCanvas();
}

function fitCanvasToBoard() {
  state.canvas.scale = 1.0;
  state.canvas.offsetX = 0;
  state.canvas.offsetY = 0;
  state.canvas.hoveredItem = null;
  renderCanvas();
}

function resetCanvasView() {
  fitCanvasToBoard();
}

function renderCanvas() {
  const canvas = document.getElementById('pcbCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const geom = state.gerber.canvasGeometry;

  // Retina High-DPI Resolution Scaling
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = rect.width;
  const h = rect.height;

  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.resetTransform();
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  if (!geom || !geom.width || !geom.height) {
    ctx.fillStyle = '#64748b';
    ctx.font = '500 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Awaiting Gerber RS-274X data upload...', w / 2, h / 2);
    return;
  }

  const theme = MASK_THEMES[state.canvas.maskTheme] || MASK_THEMES.green;
  const finish = PAD_FINISHES[state.canvas.padFinish] || PAD_FINISHES.enig;

  // Base scale calculation to center board in container
  const padding = 50;
  const availW = w - padding * 2;
  const availH = h - padding * 2;
  const baseScale = Math.min(availW / geom.width, availH / geom.height);

  ctx.save();
  // Transform to center + user pan & zoom
  ctx.translate(w / 2 + state.canvas.offsetX, h / 2 + state.canvas.offsetY);
  ctx.scale(state.canvas.scale, state.canvas.scale);

  // Center board at (0, 0)
  const bW = geom.width * baseScale;
  const bH = geom.height * baseScale;
  const originX = -bW / 2;
  const originY = -bH / 2;

  // 1. PCB Substrate (FR4 Core with chosen Soldermask Color)
  ctx.fillStyle = theme.substrate;
  ctx.beginPath();
  const cornerR = Math.min(8, Math.max(3, 4 * baseScale));
  ctx.roundRect(originX, originY, bW, bH, cornerR);
  ctx.fill();

  // Subtle CAD millimeter grid on substrate
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  const gridSize = 10 * baseScale;
  if (gridSize * state.canvas.scale > 15) {
    for (let gx = originX; gx <= originX + bW; gx += gridSize) {
      ctx.beginPath();
      ctx.moveTo(gx, originY);
      ctx.lineTo(gx, originY + bH);
      ctx.stroke();
    }
    for (let gy = originY; gy <= originY + bH; gy += gridSize) {
      ctx.beginPath();
      ctx.moveTo(originX, gy);
      ctx.lineTo(originX + bW, gy);
      ctx.stroke();
    }
  }

  // 2. Copper Traces (Top Copper Layer beneath soldermask)
  if (state.canvas.layers.copper && geom.copper_top && state.canvas.side === 'top') {
    ctx.strokeStyle = theme.copperTrack;
    ctx.lineWidth = Math.max(1.0, 0.25 * baseScale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < geom.copper_top.length; i++) {
      const line = geom.copper_top[i];
      if (line.length >= 4) {
        ctx.moveTo(originX + line[0] * baseScale, originY + (geom.height - line[1]) * baseScale);
        for (let j = 2; j < line.length; j += 2) {
          ctx.lineTo(originX + line[j] * baseScale, originY + (geom.height - line[j + 1]) * baseScale);
        }
      }
    }
    ctx.stroke();
  }

  // 3. True Board Outline & Milling Slots (Edge_Cuts RS-274X Polylines)
  if (state.canvas.layers.outline) {
    if (geom.outline && geom.outline.length > 0) {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = Math.max(1.5, 0.28 * baseScale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < geom.outline.length; i++) {
        const line = geom.outline[i];
        if (line.length >= 4) {
          ctx.moveTo(originX + line[0] * baseScale, originY + (geom.height - line[1]) * baseScale);
          for (let j = 2; j < line.length; j += 2) {
            ctx.lineTo(originX + line[j] * baseScale, originY + (geom.height - line[j + 1]) * baseScale);
          }
        }
      }
      ctx.stroke();
    } else {
      // Fallback border if Edge_Cuts file was absent
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2;
      ctx.strokeRect(originX, originY, bW, bH);
    }
  }

  // 4. SMD Pads with Exact Aperture Dimensions (Rect, Circle, RoundRect, Obround)
  if (state.canvas.layers.pads && geom.pads) {
    const activeSide = state.canvas.side;
    ctx.fillStyle = finish.fill;
    ctx.strokeStyle = finish.stroke;
    ctx.lineWidth = Math.max(0.6, 0.08 * baseScale);

    geom.pads.forEach(p => {
      if (p.side !== activeSide) return;
      const px = originX + p.x * baseScale;
      // Invert Y coordinate for Cartesian to Canvas Screen mapping
      const py = originY + (geom.height - p.y) * baseScale;
      const pw = Math.max(0.8, (p.w || 1.0) * baseScale);
      const ph = Math.max(0.8, (p.h || 1.0) * baseScale);

      ctx.beginPath();
      if (p.shape === 'circle') {
        const rad = Math.max(0.6, pw / 2);
        ctx.arc(px, py, rad, 0, Math.PI * 2);
      } else if (p.shape === 'roundrect' || p.shape === 'obround') {
        const rVal = p.shape === 'obround' ? Math.min(pw, ph) / 2 : (p.r ? p.r * baseScale : Math.min(pw, ph) * 0.25);
        const rad = Math.min(rVal, pw / 2, ph / 2);
        ctx.roundRect(px - pw / 2, py - ph / 2, pw, ph, rad);
      } else {
        // Standard rectangular pad
        ctx.rect(px - pw / 2, py - ph / 2, pw, ph);
      }
      ctx.fill();
      ctx.stroke();
    });
  }

  // 5. Drill Holes (Excellon PTH Vias / Pins with Plated Rings vs NPTH Cutouts)
  if (state.canvas.layers.drills && geom.drills) {
    geom.drills.forEach(d => {
      const dx = originX + d.x * baseScale;
      const dy = originY + (geom.height - d.y) * baseScale;
      const r = Math.max(0.8, (d.r || 0.2) * baseScale);

      if (d.pth) {
        // Plated copper / gold annular ring
        const ringWidth = Math.max(1.0, 0.22 * baseScale);
        ctx.fillStyle = finish.fill;
        ctx.beginPath();
        ctx.arc(dx, dy, r + ringWidth, 0, Math.PI * 2);
        ctx.fill();

        // Dark hole cutout interior
        ctx.fillStyle = '#040711';
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Non-plated mechanical hole cutout (NPTH)
        ctx.fillStyle = '#040711';
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = Math.max(1, 0.1 * baseScale);
        ctx.beginPath();
        ctx.arc(dx, dy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    });
  }

  // 6. Silkscreen Vectors (Component Outlines, Pin 1 Markers, Reference Designators)
  if (state.canvas.layers.silk) {
    const silkLines = state.canvas.side === 'top' ? geom.silk_top : geom.silk_bot;
    if (silkLines && silkLines.length > 0) {
      ctx.strokeStyle = theme.silk;
      ctx.lineWidth = Math.max(0.8, 0.12 * baseScale);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < silkLines.length; i++) {
        const line = silkLines[i];
        if (line.length >= 4) {
          ctx.moveTo(originX + line[0] * baseScale, originY + (geom.height - line[1]) * baseScale);
          for (let j = 2; j < line.length; j += 2) {
            ctx.lineTo(originX + line[j] * baseScale, originY + (geom.height - line[j + 1]) * baseScale);
          }
        }
      }
      ctx.stroke();
    }
  }

  // 7. Highlight Hovered Element (Pad or Drill)
  if (state.canvas.hoveredItem) {
    const hi = state.canvas.hoveredItem;
    const hx = originX + hi.x * baseScale;
    const hy = originY + (geom.height - hi.y) * baseScale;

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    if (hi.shape) {
      const hw = (hi.w || 1.0) * baseScale + 4;
      const hh = (hi.h || 1.0) * baseScale + 4;
      ctx.strokeRect(hx - hw / 2, hy - hh / 2, hw, hh);
    } else {
      const hr = (hi.r || 0.3) * baseScale + 3;
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  ctx.restore();

  // Update Stats Footer
  const activeSidePads = geom.pads ? geom.pads.filter(p => p.side === state.canvas.side).length : 0;
  const silkCount = (state.canvas.side === 'top' ? geom.silk_top?.length : geom.silk_bot?.length) || 0;
  const outlineCount = geom.outline?.length || 0;
  document.getElementById('canvasStatsText').innerText = 
    `Rendered ${activeSidePads} SMD pads (${state.canvas.side.toUpperCase()}), ${geom.drills?.length || 0} drills, ${silkCount} silk vectors, ${outlineCount} outline cuts | Zoom: ${Math.round(state.canvas.scale * 100)}%`;
}

// ==================== BOM PAD ENGINE & DATASHEET RESOLVER ====================

const KNOWN_MPNS_CLIENT = {
  'STM32F446RET': { pads: 64, type: 'SMD', package: 'LQFP-64' },
  'STM32F103C8T': { pads: 48, type: 'SMD', package: 'LQFP-48' },
  'ATMEGA328P-AU': { pads: 32, type: 'SMD', package: 'TQFP-32' },
  'ATMEGA328P-PU': { pads: 28, type: 'THT', package: 'DIP-28' },
  'ESP32-WROOM': { pads: 39, type: 'SMD', package: 'Module-38+EP' },
  'RP2040': { pads: 57, type: 'SMD', package: 'QFN-56+EP' },
  'AP7366': { pads: 5, type: 'SMD', package: 'SOT-23-5' },
  'LM73100': { pads: 10, type: 'SMD', package: 'VQFN-10' },
  'TPS63700': { pads: 11, type: 'SMD', package: 'VSON-10+EP' },
  'BQ25306': { pads: 17, type: 'SMD', package: 'WQFN-16+EP' },
  'MPQ3425': { pads: 15, type: 'SMD', package: 'QFN-14+EP' },
  'TPS564252': { pads: 6, type: 'SMD', package: 'SOT-563' },
  'AMS1117': { pads: 4, type: 'SMD', package: 'SOT-223' },
  'LM1117': { pads: 4, type: 'SMD', package: 'SOT-223' },
  'VRB1205': { pads: 6, type: 'THT', package: 'DIP-6 DC-DC' },
  'OPA1622': { pads: 11, type: 'SMD', package: 'SON-10+EP' },
  'PCM5102A': { pads: 20, type: 'SMD', package: 'TSSOP-20' },
  'PGA2311U': { pads: 16, type: 'SMD', package: 'SOIC-16W' },
  'ISO6521': { pads: 8, type: 'SMD', package: 'SOIC-8' },
  'FM25CL64': { pads: 8, type: 'SMD', package: 'SOIC-8' },
  'CH340G': { pads: 16, type: 'SMD', package: 'SOIC-16' },
  'MAX4466': { pads: 5, type: 'SMD', package: 'SC-70-5' },
  'NX5L2750': { pads: 10, type: 'SMD', package: 'XQFN-10' },
  'D3V3XA4B10LP': { pads: 10, type: 'SMD', package: 'UDFN-10' },
  'STL6P3LLH6': { pads: 8, type: 'SMD', package: 'PowerFLAT-5x6' },
  'BC847': { pads: 3, type: 'SMD', package: 'SOT-23' },
  'SS34': { pads: 2, type: 'SMD', package: 'SMA' },
  'LL4148': { pads: 2, type: 'SMD', package: 'MiniMELF' },
  'SL02': { pads: 2, type: 'SMD', package: 'SMF' },
  'G6K': { pads: 8, type: 'SMD', package: 'SMD Relay 8-pin' },
  '1048': { pads: 4, type: 'THT', package: 'Battery Clip 4-pin' },
  '54-00174': { pads: 4, type: 'SMD', package: 'Audio Jack 4-pin' },
  'NRJ4HH': { pads: 4, type: 'THT', package: 'Neutrik 1/4in Jack 4-pin' },
  'MICROSD': { pads: 13, type: 'SMD', package: 'MicroSD Socket' }
};

function generateDatasheetUrl(mpn, desc) {
  const q = (mpn && mpn.length > 2 ? mpn : desc || '').replace(/[\(\)\[\]]/g, '').trim();
  return `https://www.alldatasheet.com/view.jsp?Searchword=${encodeURIComponent(q)}`;
}

function generateGooglePinoutUrl(mpn, desc, fp) {
  const target = `${mpn || desc || ''} ${fp || ''} datasheet pinout package`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(target)}`;
}

function estimateComponentPads(item) {
  const des = String(item.designator || '').trim();
  const desc = String(item.description || '').trim();
  const fp = String(item.footprint || '').trim();
  const mpn = String(item.mpn || '').trim();
  const qty = Math.max(1, parseInt(item.quantity) || 1);

  const firstDes = des.split(/[,;\s]+/)[0] || '';
  const prefixMatch = firstDes.match(/^([A-Za-z]+)/);
  const desPrefix = prefixMatch ? prefixMatch[1].toUpperCase() : '';

  const textToCheck = `${desc} ${fp} ${mpn}`.toUpperCase();
  const dsUrl = generateDatasheetUrl(mpn, desc);
  const pinoutUrl = generateGooglePinoutUrl(mpn, desc, fp);

  // 1. Check Known MPN Database
  for (const [key, val] of Object.entries(KNOWN_MPNS_CLIENT)) {
    if (textToCheck.includes(key.toUpperCase())) {
      return {
        pads_per_unit: val.pads,
        pad_type: val.type,
        package_name: val.package,
        line_total_pads: val.pads * qty,
        confidence: 1.0,
        is_manual: false,
        resolution_source: `Known IC (${key})`,
        datasheet_url: dsUrl,
        google_pinout_url: pinoutUrl,
        notes: `${val.package} (${val.pads} pads)`
      };
    }
  }

  // 2. Resistors, Capacitors, Inductors, Diodes, Ferrite Beads, LEDs (Straightforward 2-pad)
  const isPassivePrefix = ['R', 'C', 'L', 'D', 'FB', 'F', 'Z', 'LED'].includes(desPrefix);
  const isPassiveText = /RESISTOR|CAPACITOR|INDUCTOR|FERRITE|FUSE|ZENER|DIODE|LED|MLCC|0603|0805|0402|1206|1210|1812|2010|2512|SOD-123|SOD-323|SMA|SMB|SMC|MINIMELF|MELF|SMF/i.test(textToCheck);

  if (isPassivePrefix || isPassiveText) {
    if (/ARRAY|RPACK|NET|RN|EXB|CAY/i.test(textToCheck)) {
      const mArr = textToCheck.match(/(\d+)X(\d+)|(\d+)[-_]?(?:PIN|RES|WAY)/);
      if (mArr) {
        const count = parseInt(mArr[1] || mArr[3]) * 2;
        return {
          pads_per_unit: count,
          pad_type: 'SMD',
          package_name: `Resistor Array (${count}-pad)`,
          line_total_pads: count * qty,
          confidence: 0.95,
          is_manual: false,
          resolution_source: 'Resistor Network Rule',
          datasheet_url: dsUrl,
          google_pinout_url: pinoutUrl,
          notes: `Multi-channel array (${count} pads)`
        };
      }
    }

    const isTht = /radial|tht|through_hole|dip|axial/i.test(fp);
    return {
      pads_per_unit: 2,
      pad_type: isTht ? 'THT' : 'SMD',
      package_name: isTht ? 'THT 2-Pin Radial' : 'SMD Chip 2-Pad',
      line_total_pads: 2 * qty,
      confidence: 1.0,
      is_manual: false,
      resolution_source: 'Standard 2-Terminal Passive Rule',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: 'Standard 2-pad passive'
    };
  }

  // 3. Testpoints, Solder Jumpers, Fiducials
  if (desPrefix === 'TP' || textToCheck.includes('TESTPOINT')) {
    return {
      pads_per_unit: 1,
      pad_type: 'SMD',
      package_name: 'Test Point Pad',
      line_total_pads: 1 * qty,
      confidence: 1.0,
      is_manual: false,
      resolution_source: 'Testpoint (1 Pad)',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: 'Single test probe pad'
    };
  }

  if (['JP', 'JMP'].includes(desPrefix) || textToCheck.includes('JUMPER')) {
    const mJmp = fp.match(/Jumper[-_]?(\d+)/i);
    const pads = mJmp ? parseInt(mJmp[1]) : 2;
    return {
      pads_per_unit: pads,
      pad_type: 'SMD',
      package_name: `Solder Jumper (${pads}-pad)`,
      line_total_pads: pads * qty,
      confidence: 1.0,
      is_manual: false,
      resolution_source: `Solder Jumper (${pads} pads)`,
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `Configurable solder bridge (${pads} pads)`
    };
  }

  // 4. Potentiometers / Trimmers
  if (['RV', 'POT', 'VR'].includes(desPrefix) || textToCheck.includes('POTENTIOMETER') || textToCheck.includes('3296')) {
    return {
      pads_per_unit: 3,
      pad_type: 'THT',
      package_name: 'Trimmer / Potentiometer',
      line_total_pads: 3 * qty,
      confidence: 1.0,
      is_manual: false,
      resolution_source: 'Potentiometer (3 Pins)',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: '3-terminal variable resistor'
    };
  }

  // 5. Switches & Push Buttons
  if (['SW', 'BTN', 'KEY'].includes(desPrefix) || textToCheck.includes('SWITCH') || textToCheck.includes('PUSH')) {
    return {
      pads_per_unit: 4,
      pad_type: /SMD|SKRK|TACT/i.test(textToCheck) ? 'SMD' : 'THT',
      package_name: 'Tact Switch 4-Pin',
      line_total_pads: 4 * qty,
      confidence: 0.95,
      is_manual: false,
      resolution_source: 'Tact Switch (4 Pins)',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: 'Standard tactile button'
    };
  }

  // 6. Crystals & Oscillators
  if (['Y', 'X', 'XTAL'].includes(desPrefix) || textToCheck.includes('CRYSTAL')) {
    const is4Pin = /4PIN|4P|3225|2016|2520|5032|7050|GND/i.test(fp);
    const pads = is4Pin ? 4 : 2;
    return {
      pads_per_unit: pads,
      pad_type: 'SMD',
      package_name: is4Pin ? 'SMD 4-Pad Crystal' : '2-Pin Crystal',
      line_total_pads: pads * qty,
      confidence: 0.95,
      is_manual: false,
      resolution_source: `Crystal (${pads} pads)`,
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `Resonator/crystal (${pads} pads)`
    };
  }

  // 7. SOT Transistors & SC-70
  const mSot = fp.match(/SOT[-_]?(\d+)(?:[-_](\d+))?/i);
  if (mSot) {
    const base = mSot[1];
    const sub = mSot[2];
    let pads = 3;
    if (sub) pads = parseInt(sub);
    else if (base === '23') pads = 3;
    else if (['223', '89'].includes(base)) pads = 4;
    else if (['353', '705'].includes(base)) pads = 5;
    else if (['363', '563'].includes(base)) pads = 6;
    return {
      pads_per_unit: pads,
      pad_type: 'SMD',
      package_name: `SOT-${base}${sub ? '-' + sub : ''}`,
      line_total_pads: pads * qty,
      confidence: 0.98,
      is_manual: false,
      resolution_source: 'SOT Classifier',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `Small outline package (${pads} pads)`
    };
  }

  // 8. SOIC, SOP, SSOP, TSSOP, MSOP, DIP
  const mSoic = fp.match(/\b(SOIC|TSSOP|SSOP|MSOP|SOP|DIP|PDIP)[-_]?(\d+)(?:W)?\b/i);
  if (mSoic) {
    const pkg = mSoic[1].toUpperCase();
    const pads = parseInt(mSoic[2]);
    return {
      pads_per_unit: pads,
      pad_type: ['DIP', 'PDIP'].includes(pkg) ? 'THT' : 'SMD',
      package_name: `${pkg}-${pads}`,
      line_total_pads: pads * qty,
      confidence: 0.98,
      is_manual: false,
      resolution_source: `${pkg} Pinout Parser`,
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `Dual in-line package (${pads} pins)`
    };
  }

  // 9. QFP, LQFP, TQFP
  const mQfp = fp.match(/\b(LQFP|TQFP|PQFP|QFP|VQFP)[-_]?(\d+)\b/i);
  if (mQfp) {
    const pkg = mQfp[1].toUpperCase();
    const pads = parseInt(mQfp[2]);
    return {
      pads_per_unit: pads,
      pad_type: 'SMD',
      package_name: `${pkg}-${pads}`,
      line_total_pads: pads * qty,
      confidence: 0.99,
      is_manual: false,
      resolution_source: `${pkg} Pinout Parser`,
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `Quad flat package (${pads} leads)`
    };
  }

  // 10. IPC Standard Lead Strings (e.g. SON50P300X400X100-15N)
  const mIpc = fp.match(/[-_](\d+)N(?:[-_]|$)/);
  if (mIpc) {
    const pads = parseInt(mIpc[1]);
    return {
      pads_per_unit: pads,
      pad_type: 'SMD',
      package_name: `IPC Standard (${pads} Pads)`,
      line_total_pads: pads * qty,
      confidence: 0.95,
      is_manual: false,
      resolution_source: 'IPC-7351 Standard Code',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `IPC package code (${pads} pads)`
    };
  }

  // 11. QFN, DFN, UDFN (Leads + Thermal Exposed Pad)
  const mQfn = fp.match(/\b(QFN|DFN|UDFN|WDFN|VQFN|WQFN|HVQFN)[-_]?(\d+)\b/i);
  if (mQfn) {
    const pkg = mQfn[1].toUpperCase();
    const leads = parseInt(mQfn[2]);
    const hasEp = !pkg.includes('UDFN');
    const totalPads = leads + (hasEp ? 1 : 0);
    return {
      pads_per_unit: totalPads,
      pad_type: 'SMD',
      package_name: `${pkg}-${leads}${hasEp ? '+EP' : ''}`,
      line_total_pads: totalPads * qty,
      confidence: 0.95,
      is_manual: false,
      resolution_source: `${pkg} Lead Parser`,
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `${leads} leads${hasEp ? ' + 1 thermal ground pad' : ''}`
    };
  }

  // 12. BGA / CSP
  const mBga = fp.match(/\b(BGA|FBGA|VFBGA|LFBGA|WLCSP|CSP)[-_]?(\d+)\b/i);
  if (mBga) {
    const pkg = mBga[1].toUpperCase();
    const balls = parseInt(mBga[2]);
    return {
      pads_per_unit: balls,
      pad_type: 'SMD',
      package_name: `${pkg}-${balls}`,
      line_total_pads: balls * qty,
      confidence: 0.98,
      is_manual: false,
      resolution_source: 'BGA Ball Counter',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `Ball grid array (${balls} spheres)`
    };
  }

  // 13. Headers & Connectors (Rows x Cols)
  let mHdr = fp.match(/(?:PinHeader|IDC[-_]Header|Header|Pin_Header|Connector_PinHeader|Conn|JST)[-_]?(?:[A-Za-z0-9]+[-_])?(\d+)x0?(\d+)/i);
  if (!mHdr) mHdr = desc.match(/Conn[-_]0?(\d+)x0?(\d+)/i);
  if (!mHdr) mHdr = fp.match(/\b(\d+)x0?(\d+)\b/);

  if (mHdr && (['J', 'P', 'CONN', 'HDR'].includes(desPrefix) || /HEADER|CONN|JST/i.test(textToCheck))) {
    const rows = parseInt(mHdr[1]);
    const cols = parseInt(mHdr[2]);
    const pads = rows * cols;
    const isTht = !/smd|smt/i.test(fp);
    return {
      pads_per_unit: pads,
      pad_type: isTht ? 'THT' : 'SMD',
      package_name: `Header ${rows}x${cols} (${pads} pins)`,
      line_total_pads: pads * qty,
      confidence: 0.98,
      is_manual: false,
      resolution_source: `Pin Header Calculator (${rows}x${cols})`,
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: `${rows}x${cols} pin array (${pads} pins)`
    };
  }

  // 14. Transistors Default
  if (['Q', 'T'].includes(desPrefix)) {
    const isTht = /to-92|to-220|tht|through_hole/i.test(fp);
    return {
      pads_per_unit: 3,
      pad_type: isTht ? 'THT' : 'SMD',
      package_name: 'Transistor 3-Pin',
      line_total_pads: 3 * qty,
      confidence: 0.85,
      is_manual: false,
      resolution_source: 'Transistor Default (3 Pads)',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: '3-pin transistor / diode pair'
    };
  }

  // 15. Specialized Connectors
  if (/BARREL|JACK-DC/i.test(textToCheck)) {
    return {
      pads_per_unit: 3,
      pad_type: 'THT',
      package_name: 'DC Barrel Jack (3-pin)',
      line_total_pads: 3 * qty,
      confidence: 0.92,
      is_manual: false,
      resolution_source: 'DC Barrel Jack Heuristic',
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: 'Power pin, sleeve, and shunt switch contact'
    };
  }

  if (/USB/i.test(textToCheck)) {
    const pads = /TYPE-C|USB-C/i.test(textToCheck) ? 16 : (/MICRO/i.test(textToCheck) ? 9 : 6);
    return {
      pads_per_unit: pads,
      pad_type: /THT|VERTICAL/i.test(fp) ? 'THT' : 'SMD',
      package_name: `USB Connector (${pads} pins)`,
      line_total_pads: pads * qty,
      confidence: 0.9,
      is_manual: false,
      resolution_source: `USB Standard (${pads} pins)`,
      datasheet_url: dsUrl,
      google_pinout_url: pinoutUrl,
      notes: 'Signals + shield anchors'
    };
  }

  // 16. Fallback: Needs Manual Feed
  return {
    pads_per_unit: 0,
    pad_type: 'Unknown',
    package_name: fp || 'Unknown Package',
    line_total_pads: 0,
    confidence: 0.0,
    is_manual: true,
    resolution_source: 'Manual Feed Required',
    datasheet_url: dsUrl,
    google_pinout_url: pinoutUrl,
    notes: '⚠️ Footprint not recognized. Please verify datasheet and enter pad count.'
  };
}

function calculateBomPadsClient(items) {
  let totalSmdPads = 0;
  let totalThtPins = 0;
  let totalComponents = 0;
  let resolvedCount = 0;
  const unresolvedItems = [];
  const enriched = [];

  let hasBga = false;
  let hasQfn = false;
  let hasFinePitch = false;
  let finePitchCount = 0;

  items.forEach(it => {
    const qty = Math.max(1, parseInt(it.quantity) || 1);
    totalComponents += qty;

    // Check if manual override exists
    const override = state.bomPads.manualOverrides[it.id];
    let est;
    if (override) {
      const pCount = parseInt(override.pads_per_unit) || 0;
      est = {
        pads_per_unit: pCount,
        pad_type: override.pad_type || 'SMD',
        package_name: it.footprint || 'Custom',
        line_total_pads: pCount * qty,
        confidence: 1.0,
        is_manual: true,
        resolution_source: 'User Manual Feed',
        datasheet_url: generateDatasheetUrl(it.mpn, it.description),
        google_pinout_url: generateGooglePinoutUrl(it.mpn, it.description, it.footprint),
        notes: 'Manually verified by user'
      };
    } else {
      est = estimateComponentPads(it);
    }

    const merged = { ...it, ...est };
    enriched.push(merged);

    if (est.confidence < 0.5 || est.pads_per_unit === 0) {
      unresolvedItems.push(merged);
    } else {
      resolvedCount++;
    }

    if (est.pad_type === 'SMD') {
      totalSmdPads += est.line_total_pads;
    } else if (est.pad_type === 'THT') {
      totalThtPins += est.line_total_pads;
    }

    const pkgUpper = `${merged.package_name || ''} ${merged.footprint || ''}`.toUpperCase();
    if (pkgUpper.includes('BGA') || pkgUpper.includes('WLCSP')) hasBga = true;
    if (pkgUpper.includes('QFN') || pkgUpper.includes('DFN') || pkgUpper.includes('SON')) hasQfn = true;
    if (/LQFP|TQFP|TSSOP|P0\.5|P0\.4|P0\.65/.test(pkgUpper)) {
      hasFinePitch = true;
      finePitchCount += qty;
    }
  });

  const totalPads = totalSmdPads + totalThtPins;

  let baseComp = 20.0;
  if (totalComponents > 200) baseComp += 20.0;
  else if (totalComponents > 100) baseComp += 10.0;

  if (hasBga) baseComp += 35.0;
  if (hasQfn) baseComp += 15.0;
  if (hasFinePitch) baseComp += Math.min(20.0, finePitchCount * 1.5);

  const complexityScore = Math.min(95.0, Math.round(baseComp * 10) / 10);

  return {
    summary: {
      total_line_items: items.length,
      total_components: totalComponents,
      total_smd_pads: totalSmdPads,
      total_tht_pins: totalThtPins,
      total_pads: totalPads,
      resolved_count: resolvedCount,
      unresolved_count: unresolvedItems.length,
      resolution_pct: Math.round((resolvedCount / Math.max(1, items.length)) * 1000) / 10,
      complexity_score: complexityScore,
      has_bga: hasBga,
      has_qfn: hasQfn,
      has_fine_pitch: hasFinePitch
    },
    items: enriched,
    unresolved_items: unresolvedItems
  };
}

function parseCsvClient(rawText) {
  const lines = rawText.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return { status: 'error', items: [] };

  const firstLine = lines[0];
  const delim = firstLine.includes(';') ? ';' : (firstLine.includes('\t') ? '\t' : ',');

  const parseLine = (l) => {
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (c === delim && !inQuotes) {
        cells.push(cur.trim().replace(/^"|"$/g, ''));
        cur = '';
      } else {
        cur += c;
      }
    }
    cells.push(cur.trim().replace(/^"|"$/g, ''));
    return cells;
  };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase());
  let desIdx = headers.findIndex(h => /designator|refdes|reference|ref/i.test(h));
  let descIdx = headers.findIndex(h => /description|designation|value|comment/i.test(h));
  let fpIdx = headers.findIndex(h => /footprint|package|case/i.test(h));
  let qtyIdx = headers.findIndex(h => /quantity|qty|count/i.test(h));
  let mpnIdx = headers.findIndex(h => /mpn|mfgpart|partnumber/i.test(h));

  if (desIdx < 0) desIdx = 1;
  if (descIdx < 0) descIdx = 2;
  if (fpIdx < 0) fpIdx = 3;
  if (qtyIdx < 0) qtyIdx = 4;

  const items = [];
  let totalComponents = 0;

  for (let i = 1; i < lines.length; i++) {
    const row = parseLine(lines[i]);
    if (!row || row.length === 0) continue;

    const des = desIdx >= 0 && row[desIdx] ? row[desIdx] : '';
    const desc = descIdx >= 0 && row[descIdx] ? row[descIdx] : '';
    const fp = fpIdx >= 0 && row[fpIdx] ? row[fpIdx] : '';
    const mpn = mpnIdx >= 0 && row[mpnIdx] ? row[mpnIdx] : '';

    let qty = 1;
    if (qtyIdx >= 0 && row[qtyIdx]) {
      const qVal = parseInt(row[qtyIdx].replace(/[^\d]/g, ''));
      if (!isNaN(qVal)) qty = qVal;
    } else if (des) {
      const refs = des.split(/[,;\s]+/).filter(Boolean);
      qty = Math.max(1, refs.length);
    }

    if (!des && !desc) continue;

    items.push({
      id: items.length + 1,
      designator: des,
      description: desc,
      footprint: fp,
      quantity: qty,
      mpn: mpn,
      search_query: `${desc} ${fp}`.trim(),
      is_virtual: /testpoint|fiducial|logo/i.test(desc)
    });
    totalComponents += qty;
  }

  return {
    status: 'success',
    total_line_items: items.length,
    total_components: totalComponents,
    items: items
  };
}

// ==================== BOM PARSING & SOURCING ====================
async function uploadBomFile(file) {
  document.getElementById('bomStatusTitle').innerText = 'Parsing Bill of Materials...';
  document.getElementById('bomStatusSub').innerText = file.name;

  if (state.backend.isOnline) {
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(getApiUrl('/api/parse-bom'), {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (res.ok) {
        applyBomData(data);
        showToast('BOM parsed successfully with component pad counts!');
        return;
      }
    } catch (err) {
      console.warn('Backend parse-bom failed, using client-side CSV parser:', err);
    } finally {
      document.getElementById('bomStatusTitle').innerText = 'Upload Bill of Materials (BOM)';
      document.getElementById('bomStatusSub').innerText = 'Supports KiCad, Altium, Eagle, or Custom Excel / CSV BOM files';
    }
  }

  // Client-Side CSV Parser Fallback
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = parseCsvClient(e.target.result);
      if (parsed.status === 'success' && parsed.items.length > 0) {
        const padResults = calculateBomPadsClient(parsed.items);
        parsed.pad_analysis = padResults.summary;
        parsed.items = padResults.items;
        parsed.unresolved_items = padResults.unresolved_items;
        parsed.filename = file.name;
        applyBomData(parsed);
        showToast('BOM parsed via Client Engine with pad counts!');
      } else {
        alert('Could not parse component rows from this file.');
      }
    } catch (parseErr) {
      alert('Error parsing file: ' + parseErr.message);
    }
  };
  reader.readAsText(file);
}

async function loadSampleBom() {
  document.getElementById('bomStatusTitle').innerText = 'Loading Sample BOM...';
  try {
    const res = await fetch(getApiUrl('/api/sample-bom'));
    if (res.ok) {
      const data = await res.json();
      applyBomData(data);
      showToast('Sample BOM (AX60 Audiometer) loaded! Pad counts calculated.');
      return;
    }
  } catch (err) {
    console.warn('API /api/sample-bom unavailable, using embedded sample BOM data:', err);
  } finally {
    document.getElementById('bomStatusTitle').innerText = 'Upload Bill of Materials (BOM)';
  }

  // Standalone offline fallback
  if (typeof SAMPLE_BOM_DATA !== 'undefined' && SAMPLE_BOM_DATA) {
    applyBomData(SAMPLE_BOM_DATA);
    showToast('Sample BOM (AX60 Audiometer) loaded via Client Engine!');
  }
}

function applyBomData(data) {
  state.bom.loaded = true;
  state.bom.filename = data.filename || 'BOM.csv';
  state.bom.rawItems = data.items || [];
  state.bom.totalLineItems = data.total_line_items || data.items?.length || 0;
  state.bom.totalComponents = data.total_components || 0;

  // Process Pad Calculation
  if (data.pad_analysis) {
    state.bomPads.loaded = true;
    state.bomPads.smdPads = data.pad_analysis.total_smd_pads || 0;
    state.bomPads.thtPins = data.pad_analysis.total_tht_pins || 0;
    state.bomPads.totalPads = data.pad_analysis.total_pads || 0;
    state.bomPads.resolvedCount = data.pad_analysis.resolved_count || 0;
    state.bomPads.unresolvedCount = data.pad_analysis.unresolved_count || 0;
    state.bomPads.resolutionPct = data.pad_analysis.resolution_pct || 100;
    state.bomPads.complexityScore = data.pad_analysis.complexity_score || 50.0;
    state.bomPads.unresolvedItems = data.unresolved_items || [];
  } else {
    // Run client pad calculation
    const padResults = calculateBomPadsClient(state.bom.rawItems);
    state.bomPads.loaded = true;
    state.bomPads.smdPads = padResults.summary.total_smd_pads;
    state.bomPads.thtPins = padResults.summary.total_tht_pins;
    state.bomPads.totalPads = padResults.summary.total_pads;
    state.bomPads.resolvedCount = padResults.summary.resolved_count;
    state.bomPads.unresolvedCount = padResults.summary.unresolved_count;
    state.bomPads.resolutionPct = padResults.summary.resolution_pct;
    state.bomPads.complexityScore = padResults.summary.complexity_score;
    state.bomPads.unresolvedItems = padResults.unresolved_items;
    data.items = padResults.items;
    state.bom.rawItems = padResults.items;
  }

  // Update DOM metrics for BOM Summary
  document.getElementById('dispBomLineCount').innerText = `${state.bom.totalLineItems} Lines`;
  document.getElementById('dispBomTotalComponents').innerText = `${state.bom.totalComponents} total components`;

  // Update DOM metrics for BOM Pad Analyzer Card
  const dispTotal = document.getElementById('dispBomPadTotal');
  if (dispTotal) dispTotal.innerText = `${state.bomPads.totalPads.toLocaleString()} Pads`;
  const dispTotalSub = document.getElementById('dispBomPadTotalSub');
  if (dispTotalSub) dispTotalSub.innerText = `Across ${state.bom.totalComponents} components`;
  const dispSmd = document.getElementById('dispBomPadSmd');
  if (dispSmd) dispSmd.innerText = `${state.bomPads.smdPads.toLocaleString()} SMD`;
  const dispTht = document.getElementById('dispBomPadTht');
  if (dispTht) dispTht.innerText = `${state.bomPads.thtPins.toLocaleString()} THT`;
  const dispStatus = document.getElementById('dispBomPadStatus');
  if (dispStatus) dispStatus.innerText = `${state.bomPads.resolutionPct}%`;
  const dispStatusSub = document.getElementById('dispBomPadStatusSub');
  if (dispStatusSub) {
    dispStatusSub.innerText = state.bomPads.unresolvedCount > 0 
      ? `⚠️ ${state.bomPads.unresolvedCount} items need review` 
      : 'All packages verified';
  }

  // Update Badge in Assembly Tab Pad Source Selector
  const sourceBomBadge = document.getElementById('sourceBomPadsBadge');
  if (sourceBomBadge) sourceBomBadge.innerText = state.bomPads.totalPads.toLocaleString();

  // Update Review Button Badge
  const reviewBadge = document.getElementById('reviewCountBadge');
  if (reviewBadge) {
    reviewBadge.innerText = state.bomPads.unresolvedCount > 0 ? `${state.bomPads.unresolvedCount} Pending` : `${state.bom.totalLineItems} Total`;
  }

  // Toggle Unresolved Alert Banner
  const alertBanner = document.getElementById('unresolvedAlertBanner');
  if (alertBanner) {
    if (state.bomPads.unresolvedCount > 0) {
      alertBanner.style.display = 'flex';
      const alertCount = document.getElementById('unresolvedAlertCount');
      if (alertCount) alertCount.innerText = state.bomPads.unresolvedCount;
    } else {
      alertBanner.style.display = 'none';
    }
  }

  // Pre-populate table with parsed raw items
  state.bom.sourcedItems = state.bom.rawItems.map(item => ({
    ...item,
    vendor: item.is_virtual ? 'N/A (Virtual)' : 'Ready to Source',
    sku: item.mpn || 'Pending',
    unit_price: 0.0,
    line_total: 0.0,
    url: '#',
    alternatives: []
  }));

  renderBomTable(state.bom.sourcedItems);
  document.getElementById('exportBomBtn').disabled = true;

  // If no Gerber file is active, automatically activate BOM as pad calculation source!
  if (!state.gerber.loaded) {
    setPadSource('bom');
  } else if (state.padSource === 'bom') {
    recalcAssemblyCost();
  }

  showToast('BOM loaded & component pad counts calculated!');
}

function toggleSupplierChip(chipEl, event) {
  if (event && event.target && event.target.tagName === 'INPUT') {
    syncSupplierChips();
    return;
  }
  const checkbox = chipEl.querySelector('input');
  if (checkbox) {
    checkbox.checked = !checkbox.checked;
  }
  syncSupplierChips();
}

function syncSupplierChips() {
  const selected = [];
  document.querySelectorAll('.supplier-chip').forEach(chip => {
    const cb = chip.querySelector('input');
    if (cb) {
      chip.classList.toggle('selected', cb.checked);
      if (cb.checked) {
        selected.push(cb.value);
      }
    }
  });
  document.getElementById('supplierKeywordsInput').value = selected.join(', ');
  state.bom.preferredKeywords = selected;
}

function syncChipsFromInput() {
  const rawKeywords = document.getElementById('supplierKeywordsInput').value.toLowerCase();
  document.querySelectorAll('.supplier-chip').forEach(chip => {
    const cb = chip.querySelector('input');
    if (cb) {
      const isMatch = rawKeywords.includes(cb.value.toLowerCase());
      cb.checked = isMatch;
      chip.classList.toggle('selected', isMatch);
    }
  });
  state.bom.preferredKeywords = rawKeywords.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

async function startSourcingBOM() {
  if (!state.bom.rawItems || state.bom.rawItems.length === 0) {
    alert('Please upload or load a BOM first!');
    return;
  }

  const rawKeywords = document.getElementById('supplierKeywordsInput').value;
  const keywords = rawKeywords.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  state.bom.preferredKeywords = keywords;

  state.bom.isSourcing = true;
  const progressArea = document.getElementById('sourcingProgressArea');
  const progressBar = document.getElementById('sourcingProgressBar');
  const percentText = document.getElementById('sourcingPercentText');
  const statusText = document.getElementById('sourcingStatusText');
  const startBtn = document.getElementById('startSourcingBtn');

  progressArea.style.display = 'block';
  progressBar.style.width = '30%';
  percentText.innerText = '30%';
  statusText.innerText = `Querying ${keywords.join(', ')} for lowest prices...`;
  startBtn.disabled = true;
  startBtn.innerHTML = '<span class="spinner"></span> SOURCING PARTS...';

  try {
    const payload = {
      items: state.bom.rawItems,
      preferred_keywords: keywords,
      currency: state.currency
    };

    const res = await fetch('/api/source-bom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (res.ok) {
      progressBar.style.width = '100%';
      percentText.innerText = '100%';
      statusText.innerText = 'All components successfully matched to lowest cost parts!';

      state.bom.sourcedItems = data.items || [];
      state.bom.totalBomCost = data.total_bom_cost || 0.0;

      applySourcedBomResults(data);
      showToast('BOM sourced! Lowest price parts linked.');
    } else {
      alert('Sourcing error: ' + (data.detail || 'Unknown'));
    }
  } catch (err) {
    alert('Sourcing request error: ' + err.message);
  } finally {
    state.bom.isSourcing = false;
    startBtn.disabled = false;
    startBtn.innerText = '⚡ SOURCING ALL PARTS (FIND LOWEST PRICES)';
    setTimeout(() => {
      progressArea.style.display = 'none';
    }, 2000);
  }
}

function applySourcedBomResults(data) {
  const sym = state.currencySymbol;
  const totalCost = data.total_bom_cost || 0.0;
  const batchQty = state.assembly.numBoards || 10;
  const batchCost = totalCost * batchQty;

  document.getElementById('dispBomUnitCost').innerText = `${sym}${totalCost.toFixed(2)}`;
  document.getElementById('dispBomBatchCost').innerText = `${sym}${batchCost.toFixed(2)}`;
  document.getElementById('dispBomBatchSub').innerText = `For ${batchQty} boards`;

  // Calculate supplier mix
  const mixCounter = {};
  data.items.forEach(it => {
    if (it.vendor && it.vendor !== 'N/A (Virtual)') {
      mixCounter[it.vendor] = (mixCounter[it.vendor] || 0) + 1;
    }
  });
  const mixStr = Object.entries(mixCounter).map(([v, count]) => `${v}: ${count}`).join(' | ');
  document.getElementById('dispSupplierMix').innerText = mixStr || 'Single Supplier';

  document.getElementById('exportBomBtn').disabled = false;

  renderBomTable(data.items);
  updateTurnkeySummary();
}

function renderBomTable(items) {
  const tbody = document.getElementById('bomTableBody');
  tbody.innerHTML = '';

  const sym = state.currencySymbol;

  items.forEach((it, idx) => {
    const tr = document.createElement('tr');

    let badgeClass = 'badge-sunrom';
    if (it.vendor?.toLowerCase().includes('robu')) badgeClass = 'badge-robu';
    else if (it.vendor?.toLowerCase().includes('comp')) badgeClass = 'badge-ecomp';
    else if (it.vendor?.includes('Virtual') || it.vendor?.includes('Pending')) badgeClass = 'badge-virtual';

    const hasLink = it.url && it.url !== '#';
    const hasAlternatives = it.alternatives && it.alternatives.length > 0;
    const padsPerUnit = it.pads_per_unit != null ? it.pads_per_unit : 2;
    const padType = (it.pad_type || 'SMD').toUpperCase();
    const linePads = padsPerUnit * it.quantity;
    const dsUrl = it.datasheet_url || generateDatasheetUrl(it.mpn, it.description);

    tr.innerHTML = `
      <td>${it.id || idx + 1}</td>
      <td class="cell-designator" title="${escapeHtml(it.designator || '')}"><strong>${escapeHtml(it.designator || '--')}</strong></td>
      <td class="cell-desc" title="${escapeHtml(it.description || '')}">${escapeHtml(it.description || '--')}</td>
      <td class="cell-fp" title="${escapeHtml(it.footprint || '')}"><span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(it.footprint || '--')}</span></td>
      <td><strong>${it.quantity}</strong></td>
      <td>
        <input type="number" min="0" max="2000" class="table-pad-input" value="${padsPerUnit}" 
               onchange="updateRowPads(${idx}, this.value)" title="Pads per unit (Click to change)">
      </td>
      <td>
        <span class="badge-pad-type ${padType.toLowerCase()}" onclick="toggleRowPadType(${idx})" title="Click to toggle SMD/THT">${padType}</span>
      </td>
      <td style="font-weight: 700; color: var(--accent-cyan);" id="linePads_${idx}">
        ${linePads}
      </td>
      <td>
        <a href="${dsUrl}" target="_blank" rel="noopener" class="btn-datasheet" title="View Component Datasheet">📄 Doc ↗</a>
      </td>
      <td><span class="supplier-badge ${badgeClass}">${escapeHtml(it.vendor || 'N/A')}</span></td>
      <td><span style="font-family: var(--font-mono); font-size: 0.72rem;">${escapeHtml(it.sku || '--')}</span></td>
      <td>
        <input type="number" step="0.01" min="0" class="editable-price" value="${it.unit_price || 0.0}" 
               onchange="updateRowPrice(${idx}, this.value)">
      </td>
      <td style="font-weight: 700; color: var(--accent-emerald);" id="lineTotal_${idx}">
        ${sym}${(it.line_total || 0).toFixed(2)}
      </td>
      <td>
        ${hasLink ? `<a href="${it.url}" target="_blank" rel="noopener" class="part-link-btn" title="Open ${it.vendor} product page">View Part ↗</a>` : '<span style="color:var(--text-muted);">-</span>'}
      </td>
      <td>
        ${hasAlternatives ? `<button class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.72rem;" onclick="openAlternativesModal(${idx})">Compare (${it.alternatives.length})</button>` : '<span style="color:var(--text-muted); font-size: 0.72rem;">Best match</span>'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('tableRowCountText').innerText = `Showing ${items.length} items`;
}

function updateRowPads(idx, valStr) {
  const item = state.bom.sourcedItems[idx];
  if (!item) return;

  const pads = Math.max(0, parseInt(valStr) || 0);
  item.pads_per_unit = pads;
  item.line_total_pads = pads * item.quantity;
  item.is_manual = true;
  state.bomPads.manualOverrides[item.id] = { pads_per_unit: pads, pad_type: item.pad_type || 'SMD' };

  // Update line pads cell
  const el = document.getElementById(`linePads_${idx}`);
  if (el) el.innerText = item.line_total_pads;

  recalcBomPadTotals();
}

function toggleRowPadType(idx) {
  const item = state.bom.sourcedItems[idx];
  if (!item) return;

  item.pad_type = (item.pad_type === 'THT') ? 'SMD' : 'THT';
  item.is_manual = true;
  state.bomPads.manualOverrides[item.id] = { pads_per_unit: item.pads_per_unit, pad_type: item.pad_type };

  recalcBomPadTotals();
  renderBomTable(state.bom.sourcedItems);
}

function recalcBomPadTotals() {
  let smd = 0;
  let tht = 0;
  let unresolved = 0;

  state.bom.sourcedItems.forEach(it => {
    const linePads = (it.pads_per_unit != null ? it.pads_per_unit : 2) * it.quantity;
    if (it.pad_type === 'THT') {
      tht += linePads;
    } else {
      smd += linePads;
    }
    if (!it.pads_per_unit && it.pads_per_unit !== 0) {
      unresolved++;
    } else if (it.pads_per_unit === 0 && !it.is_manual) {
      unresolved++;
    }
  });

  state.bomPads.smdPads = smd;
  state.bomPads.thtPins = tht;
  state.bomPads.totalPads = smd + tht;
  state.bomPads.unresolvedCount = unresolved;

  // Update DOM
  const dispTotal = document.getElementById('dispBomPadTotal');
  if (dispTotal) dispTotal.innerText = `${state.bomPads.totalPads.toLocaleString()} Pads`;
  const dispSmd = document.getElementById('dispBomPadSmd');
  if (dispSmd) dispSmd.innerText = `${state.bomPads.smdPads.toLocaleString()} SMD`;
  const dispTht = document.getElementById('dispBomPadTht');
  if (dispTht) dispTht.innerText = `${state.bomPads.thtPins.toLocaleString()} THT`;

  const srcBomBadge = document.getElementById('sourceBomPadsBadge');
  if (srcBomBadge) srcBomBadge.innerText = state.bomPads.totalPads.toLocaleString();

  const reviewBadge = document.getElementById('reviewCountBadge');
  if (reviewBadge) {
    reviewBadge.innerText = state.bomPads.unresolvedCount > 0 ? `${state.bomPads.unresolvedCount} Pending` : `${state.bom.totalLineItems} Total`;
  }

  // If in BOM pad source mode, recalculate assembly cost immediately
  if (state.padSource === 'bom') {
    recalcAssemblyCost();
    updateTurnkeySummary();
  }
}

// ==================== MANUAL FEED & REVIEW MODAL ====================
let activeManualFeedFilter = 'all';

function openManualFeedModal(filterType = 'all') {
  activeManualFeedFilter = filterType;
  updateManualFeedFilterPills();
  renderManualFeedTable();
  document.getElementById('manualFeedModal').classList.add('active');
}

function closeManualFeedModal() {
  document.getElementById('manualFeedModal').classList.remove('active');
}

function filterManualFeedTable(type) {
  activeManualFeedFilter = type;
  updateManualFeedFilterPills();
  renderManualFeedTable();
}

function updateManualFeedFilterPills() {
  const items = state.bom.sourcedItems || [];
  const allCount = items.length;
  const unresCount = items.filter(it => (!it.pads_per_unit && it.pads_per_unit !== 0) || (it.pads_per_unit === 0 && !it.is_manual) || (it.confidence && it.confidence < 0.5)).length;
  const smdCount = items.filter(it => (it.pad_type || 'SMD').toUpperCase() === 'SMD').length;
  const thtCount = items.filter(it => (it.pad_type || '').toUpperCase() === 'THT').length;

  const mfAll = document.getElementById('mfCountAll');
  if (mfAll) mfAll.innerText = allCount;
  const mfUn = document.getElementById('mfCountUnresolved');
  if (mfUn) mfUn.innerText = unresCount;
  const mfS = document.getElementById('mfCountSmd');
  if (mfS) mfS.innerText = smdCount;
  const mfT = document.getElementById('mfCountTht');
  if (mfT) mfT.innerText = thtCount;

  ['all', 'unresolved', 'smd', 'tht'].forEach(t => {
    const pill = document.getElementById('filterPill' + t.charAt(0).toUpperCase() + t.slice(1));
    if (pill) pill.classList.toggle('active', activeManualFeedFilter === t);
  });
}

function renderManualFeedTable() {
  const tbody = document.getElementById('manualFeedTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const q = (document.getElementById('manualFeedSearchInput')?.value || '').toLowerCase().trim();
  const items = state.bom.sourcedItems || [];

  let filtered = items.filter(it => {
    const isUnres = (!it.pads_per_unit && it.pads_per_unit !== 0) || (it.pads_per_unit === 0 && !it.is_manual) || (it.confidence && it.confidence < 0.5);
    const isSmd = (it.pad_type || 'SMD').toUpperCase() === 'SMD';
    const isTht = (it.pad_type || '').toUpperCase() === 'THT';

    if (activeManualFeedFilter === 'unresolved' && !isUnres) return false;
    if (activeManualFeedFilter === 'smd' && !isSmd) return false;
    if (activeManualFeedFilter === 'tht' && !isTht) return false;

    if (q) {
      const match = (it.designator && it.designator.toLowerCase().includes(q)) ||
                    (it.description && it.description.toLowerCase().includes(q)) ||
                    (it.footprint && it.footprint.toLowerCase().includes(q)) ||
                    (it.mpn && it.mpn.toLowerCase().includes(q));
      if (!match) return false;
    }
    return true;
  });

  filtered.forEach(it => {
    const tr = document.createElement('tr');
    const isUnres = (!it.pads_per_unit && it.pads_per_unit !== 0) || (it.pads_per_unit === 0 && !it.is_manual) || (it.confidence && it.confidence < 0.5);
    if (isUnres) tr.className = 'highlight-unresolved';

    const pCount = it.pads_per_unit != null ? it.pads_per_unit : 2;
    const pType = (it.pad_type || 'SMD').toUpperCase();
    const linePads = pCount * it.quantity;
    const dsUrl = it.datasheet_url || generateDatasheetUrl(it.mpn, it.description);
    const pinoutUrl = it.google_pinout_url || generateGooglePinoutUrl(it.mpn, it.description, it.footprint);

    tr.innerHTML = `
      <td>${it.id}</td>
      <td title="${escapeHtml(it.designator || '')}"><strong>${escapeHtml(it.designator || '--')}</strong></td>
      <td title="${escapeHtml(it.description || '')}">${escapeHtml(it.description || '--')}</td>
      <td title="${escapeHtml(it.footprint || '')}"><span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(it.footprint || '--')}</span></td>
      <td><strong>${it.quantity}</strong></td>
      <td style="text-align: center;">
        <input type="number" min="0" max="2000" class="table-pad-input" value="${pCount}" 
               onchange="updateManualFeedPads(${it.id}, this.value)" style="width: 55px;">
      </td>
      <td style="text-align: center;">
        <select class="form-control" style="padding: 0.2rem 0.4rem; font-size: 0.75rem; width: 75px;" onchange="updateManualFeedType(${it.id}, this.value)">
          <option value="SMD" ${pType === 'SMD' ? 'selected' : ''}>SMD</option>
          <option value="THT" ${pType === 'THT' ? 'selected' : ''}>THT</option>
        </select>
      </td>
      <td style="text-align: right; font-weight: 700; color: var(--accent-cyan);" id="mfLinePads_${it.id}">${linePads}</td>
      <td>
        <span style="font-size: 0.75rem; color: ${isUnres ? 'var(--accent-amber)' : 'var(--text-secondary)'};">
          ${isUnres ? '⚠️ Needs Review' : escapeHtml(it.resolution_source || it.package_name || 'Verified')}
        </span>
      </td>
      <td style="text-align: center; white-space: nowrap;">
        <a href="${dsUrl}" target="_blank" rel="noopener" class="btn-datasheet" title="Search Alldatasheet">📄 Datasheet ↗</a>
        <a href="${pinoutUrl}" target="_blank" rel="noopener" class="btn-datasheet" style="margin-left: 0.25rem;" title="Search Google Pinout">🔍 Pinout ↗</a>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateManualFeedTotals();
}

function updateManualFeedPads(id, val) {
  const item = state.bom.sourcedItems.find(it => it.id === id);
  if (!item) return;

  const count = Math.max(0, parseInt(val) || 0);
  item.pads_per_unit = count;
  item.line_total_pads = count * item.quantity;
  item.is_manual = true;
  state.bomPads.manualOverrides[id] = { pads_per_unit: count, pad_type: item.pad_type || 'SMD' };

  const cell = document.getElementById(`mfLinePads_${id}`);
  if (cell) cell.innerText = item.line_total_pads;

  updateManualFeedTotals();
}

function updateManualFeedType(id, type) {
  const item = state.bom.sourcedItems.find(it => it.id === id);
  if (!item) return;

  item.pad_type = type.toUpperCase();
  item.is_manual = true;
  state.bomPads.manualOverrides[id] = { pads_per_unit: item.pads_per_unit, pad_type: item.pad_type };

  updateManualFeedTotals();
}

function updateManualFeedTotals() {
  let total = 0;
  let smd = 0;
  let tht = 0;

  (state.bom.sourcedItems || []).forEach(it => {
    const pCount = it.pads_per_unit != null ? it.pads_per_unit : 2;
    const linePads = pCount * it.quantity;
    total += linePads;
    if ((it.pad_type || 'SMD').toUpperCase() === 'THT') {
      tht += linePads;
    } else {
      smd += linePads;
    }
  });

  const mfTot = document.getElementById('mfTotalPads');
  if (mfTot) mfTot.innerText = total.toLocaleString();
  const mfSmd = document.getElementById('mfTotalSmd');
  if (mfSmd) mfSmd.innerText = smd.toLocaleString();
  const mfTht = document.getElementById('mfTotalTht');
  if (mfTht) mfTht.innerText = tht.toLocaleString();
}

function saveManualFeedChanges() {
  recalcBomPadTotals();
  renderBomTable(state.bom.sourcedItems);
  closeManualFeedModal();
  showToast('Manual feed changes saved & pad counts updated!');
}

function resetManualFeedToAuto() {
  state.bomPads.manualOverrides = {};
  state.bom.sourcedItems.forEach(it => {
    delete it.is_manual;
    const est = estimateComponentPads(it);
    it.pads_per_unit = est.pads_per_unit;
    it.pad_type = est.pad_type;
    it.line_total_pads = est.line_total_pads;
    it.package_name = est.package_name;
    it.resolution_source = est.resolution_source;
  });

  updateManualFeedFilterPills();
  renderManualFeedTable();
  recalcBomPadTotals();
  renderBomTable(state.bom.sourcedItems);
  showToast('Reset all components to auto-detected packages.');
}

// ==================== BACKEND CONNECTION MODAL ====================
function openBackendModal() {
  const input = document.getElementById('backendUrlInput');
  if (input) input.value = state.backend.baseUrl || '';

  const dot = document.getElementById('modalStatusDot');
  const title = document.getElementById('modalEngineStatusTitle');
  const sub = document.getElementById('modalEngineStatusSub');

  if (state.backend.isOnline) {
    if (dot) dot.className = 'status-dot online';
    if (title) title.innerText = 'Connected to Backend Engine';
    if (sub) sub.innerText = `Active API: ${state.backend.baseUrl || 'Local Server (http://127.0.0.1:8000)'}`;
  } else {
    if (dot) dot.className = 'status-dot standalone';
    if (title) title.innerText = 'Standalone Browser Engine (Offline / GitHub Pages)';
    if (sub) sub.innerText = 'BOM parsing & pad calculations run 100% locally in browser.';
  }

  document.getElementById('backendConfigModal').classList.add('active');
}

function closeBackendModal() {
  document.getElementById('backendConfigModal').classList.remove('active');
}

async function testBackendConnection() {
  const input = document.getElementById('backendUrlInput');
  const testUrl = (input.value || '').trim().replace(/\/$/, '');
  const title = document.getElementById('modalEngineStatusTitle');
  const sub = document.getElementById('modalEngineStatusSub');
  const dot = document.getElementById('modalStatusDot');

  title.innerText = 'Testing connection...';
  dot.className = 'status-dot';

  try {
    const target = (testUrl || '') + '/api/health';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(target, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      dot.className = 'status-dot online';
      title.innerText = 'Connection Successful!';
      sub.innerText = `Successfully verified backend at ${target}`;
      return;
    }
  } catch (err) {
    // Error
  }

  dot.className = 'status-dot offline';
  title.innerText = 'Connection Failed';
  sub.innerText = 'Could not reach backend at this address. Check if server is running.';
}

function saveBackendConfig() {
  const input = document.getElementById('backendUrlInput');
  const val = (input.value || '').trim();
  state.backend.baseUrl = val;
  if (val) {
    localStorage.setItem('circuit_iq_backend_url', val);
  } else {
    localStorage.removeItem('circuit_iq_backend_url');
  }

  checkBackendHealth();
  closeBackendModal();
  showToast('Backend configuration saved!');
}

function updateRowPrice(idx, newPriceStr) {
  const newPrice = parseFloat(newPriceStr) || 0.0;
  const item = state.bom.sourcedItems[idx];
  if (!item) return;

  item.unit_price = newPrice;
  item.line_total = parseFloat((newPrice * item.quantity).toFixed(2));

  document.getElementById(`lineTotal_${idx}`).innerText = `${state.currencySymbol}${item.line_total.toFixed(2)}`;

  // Recalculate BOM total
  let newTotal = 0;
  state.bom.sourcedItems.forEach(it => {
    newTotal += it.line_total || 0;
  });
  state.bom.totalBomCost = parseFloat(newTotal.toFixed(2));

  const sym = state.currencySymbol;
  const batchQty = state.assembly.numBoards || 10;
  document.getElementById('dispBomUnitCost').innerText = `${sym}${state.bom.totalBomCost.toFixed(2)}`;
  document.getElementById('dispBomBatchCost').innerText = `${sym}${(state.bom.totalBomCost * batchQty).toFixed(2)}`;

  updateTurnkeySummary();
}

function filterBomTable() {
  const q = document.getElementById('bomSearchInput').value.toLowerCase().trim();
  if (!state.bom.sourcedItems) return;

  const filtered = state.bom.sourcedItems.filter(it => {
    return (it.designator && it.designator.toLowerCase().includes(q)) ||
           (it.description && it.description.toLowerCase().includes(q)) ||
           (it.footprint && it.footprint.toLowerCase().includes(q)) ||
           (it.vendor && it.vendor.toLowerCase().includes(q)) ||
           (it.sku && it.sku.toLowerCase().includes(q));
  });

  renderBomTable(filtered);
}

// ==================== ALTERNATIVES COMPARISON MODAL ====================
let currentAlternativeRowIndex = -1;

function openAlternativesModal(idx) {
  currentAlternativeRowIndex = idx;
  const item = state.bom.sourcedItems[idx];
  if (!item) return;

  document.getElementById('modalPartTitle').innerText = `${item.description} (${item.footprint})`;
  document.getElementById('modalPartDesc').innerText = `Ref: ${item.designator} | Qty: ${item.quantity} | Current: ${item.vendor} (${state.currencySymbol}${item.unit_price})`;

  const list = document.getElementById('modalOffersList');
  list.innerHTML = '';

  const sym = state.currencySymbol;

  // Add current best offer
  const curCard = document.createElement('div');
  curCard.className = 'offer-card';
  curCard.style.borderColor = 'var(--accent-emerald)';
  curCard.innerHTML = `
    <div>
      <span class="supplier-badge badge-sunrom" style="margin-bottom: 0.2rem;">${item.vendor} (Selected)</span>
      <div style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(item.title || item.description)}</div>
      <div style="font-size: 0.75rem; color: var(--text-muted);">SKU: ${item.sku}</div>
    </div>
    <div style="text-align: right;">
      <div style="font-size: 1.1rem; font-weight: 700; color: var(--accent-emerald);">${sym}${item.unit_price}</div>
      <a href="${item.url}" target="_blank" class="part-link-btn" style="margin-top: 0.3rem;">Open ↗</a>
    </div>
  `;
  list.appendChild(curCard);

  // Add alternative offers
  item.alternatives.forEach(alt => {
    const card = document.createElement('div');
    card.className = 'offer-card';
    card.innerHTML = `
      <div>
        <span class="supplier-badge badge-robu" style="margin-bottom: 0.2rem;">${alt.vendor}</span>
        <div style="font-weight: 600; font-size: 0.85rem;">${escapeHtml(alt.title)}</div>
        <div style="font-size: 0.75rem; color: var(--text-muted);">SKU: ${alt.sku}</div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 1.1rem; font-weight: 700; color: var(--text-primary);">${sym}${alt.price}</div>
        <div style="display: flex; gap: 0.4rem; justify-content: flex-end; margin-top: 0.3rem;">
          <a href="${alt.url}" target="_blank" class="part-link-btn">Open ↗</a>
          <button class="btn btn-primary" style="padding: 0.2rem 0.6rem; font-size: 0.72rem;" onclick="selectAlternativeOffer(${alt.price}, '${escapeHtml(alt.vendor)}', '${escapeHtml(alt.sku)}', '${alt.url}', '${escapeHtml(alt.title)}')">Use Offer</button>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  document.getElementById('alternativesModal').classList.add('active');
}

function selectAlternativeOffer(price, vendor, sku, url, title) {
  if (currentAlternativeRowIndex < 0) return;
  const item = state.bom.sourcedItems[currentAlternativeRowIndex];
  if (!item) return;

  item.unit_price = price;
  item.vendor = vendor;
  item.sku = sku;
  item.url = url;
  item.title = title;
  item.line_total = parseFloat((price * item.quantity).toFixed(2));

  closeAlternativesModal();
  renderBomTable(state.bom.sourcedItems);
  showToast(`Switched part to ${vendor}!`);
}

function closeAlternativesModal() {
  document.getElementById('alternativesModal').classList.remove('active');
  currentAlternativeRowIndex = -1;
}

// ==================== EXCEL EXPORT ====================
async function exportEnrichedBOM() {
  if (!state.bom.sourcedItems || state.bom.sourcedItems.length === 0) {
    alert('Please source the BOM first!');
    return;
  }

  showToast('Generating enriched Excel workbook with hyperlinks...');

  try {
    const payload = {
      sourced_data: {
        currency: state.currency,
        currency_symbol: state.currencySymbol,
        total_bom_cost: state.bom.totalBomCost,
        total_line_items: state.bom.totalLineItems,
        preferred_websites: state.bom.preferredKeywords,
        items: state.bom.sourcedItems
      },
      project_name: state.gerber.filename.replace(/\.[^/.]+$/, "") || "PCBA_Project"
    };

    const res = await fetch('/api/export-bom', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `Enriched_BOM_${state.currency}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      showToast('Excel workbook downloaded successfully!');
    } else {
      alert('Export failed.');
    }
  } catch (err) {
    alert('Export error: ' + err.message);
  }
}

// ==================== TAB 3: TURNKEY PCBA ROLLUP ====================
function updateTurnkeySummary() {
  const qty = state.assembly.numBoards || 10;
  const sym = state.currencySymbol;

  // 1. Bare PCB Fabrication Estimate
  // Area (cm²), Layers, Quantity
  const area = state.gerber.areaCm2 || 100;
  const layers = state.gerber.layerCount || 2;
  const layerMultiplier = layers === 2 ? 1.0 : (layers === 4 ? 2.1 : 3.5);
  const basePcbPerCm2 = 0.45 / (state.currency === 'USD' ? state.usdRate : 1.0);
  const pcbUnit = Math.max(15, area * basePcbPerCm2 * layerMultiplier);
  const pcbSetup = (layers >= 4 ? 2500 : 1200) / (state.currency === 'USD' ? state.usdRate : 1.0);
  const totalPcbCost = pcbSetup + (pcbUnit * qty);

  // 2. Assembly Cost
  const totalAssemblyCost = state.assembly.totalCost || 2500;

  // 3. Component BOM Cost
  const unitBomCost = state.bom.totalBomCost || 450;
  const totalBomCost = unitBomCost * qty;

  // Turnkey Grand Total
  const turnkeyGrandTotal = totalPcbCost + totalAssemblyCost + totalBomCost;
  const turnkeyUnitCost = turnkeyGrandTotal / qty;

  document.getElementById('dispTurnkeyGrandTotal').innerText = `${sym}${turnkeyGrandTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById('dispTurnkeyUnitCost').innerText = `${sym}${turnkeyUnitCost.toFixed(2)} / board`;
  document.getElementById('dispTurnkeyQty').innerText = qty;

  // Percentages
  const pcbPct = Math.round((totalPcbCost / turnkeyGrandTotal) * 100) || 20;
  const assemblyPct = Math.round((totalAssemblyCost / turnkeyGrandTotal) * 100) || 30;
  const bomPct = 100 - pcbPct - assemblyPct;

  document.getElementById('barPcb').style.width = `${pcbPct}%`;
  document.getElementById('barAssembly').style.width = `${assemblyPct}%`;
  document.getElementById('barBom').style.width = `${bomPct}%`;

  document.getElementById('dispPcbPct').innerText = `${pcbPct}%`;
  document.getElementById('dispAssemblyPct').innerText = `${assemblyPct}%`;
  document.getElementById('dispBomPct').innerText = `${bomPct}%`;

  // Details Column 1: PCB
  document.getElementById('turnkeyPcbCost').innerText = `${sym}${totalPcbCost.toFixed(2)}`;
  document.getElementById('turnkeyPcbSpecs').innerText = `${state.gerber.widthMm} × ${state.gerber.heightMm} mm | ${layers} Layers`;
  document.getElementById('turnkeyPcbUnit').innerText = `${sym}${pcbUnit.toFixed(2)}`;
  document.getElementById('turnkeyPcbSetup').innerText = `${sym}${pcbSetup.toFixed(2)}`;

  // Details Column 2: Assembly
  document.getElementById('turnkeyAssemblyCost').innerText = `${sym}${totalAssemblyCost.toFixed(2)}`;
  document.getElementById('turnkeyAssemblySpecs').innerText = `${state.gerber.smdTotal} SMD | ${state.gerber.thtPins} THT | ${state.assembly.type}`;
  document.getElementById('turnkeyPlacementSub').innerText = `${sym}${(state.assembly.smdCost + state.assembly.thtCost).toFixed(2)}`;
  document.getElementById('turnkeySetupSub').innerText = `${sym}${(state.assembly.stencilCost + state.assembly.setupCost).toFixed(2)}`;
  document.getElementById('turnkeyCompSub').innerText = `+${sym}${state.assembly.complexitySurcharge.toFixed(2)}`;

  // Details Column 3: BOM
  document.getElementById('turnkeyBomCost').innerText = `${sym}${totalBomCost.toFixed(2)}`;
  document.getElementById('turnkeyBomSpecs').innerText = `${state.bom.totalLineItems} Unique Lines | Sourced`;
  document.getElementById('turnkeyBomUnit').innerText = `${sym}${unitBomCost.toFixed(2)}`;
  document.getElementById('turnkeyBomBatch').innerText = `${sym}${totalBomCost.toFixed(2)}`;
}

// Utility: HTML Escaping
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}
