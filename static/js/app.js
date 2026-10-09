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
  // Auto-load sample gerber & bom on initial load for instant wow experience
  loadSampleGerber();
});

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
    const res = await fetch('/api/sample-gerber');
    const data = await res.json();
    if (res.ok) {
      applyGerberData(data);
      showToast('Sample Gerber (AX60 4-Layer) loaded!');
    }
  } catch (err) {
    console.error('Failed to load sample gerber:', err);
  } finally {
    document.getElementById('gerberStatusTitle').innerText = 'Drop Gerber ZIP Archive Here';
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

// ==================== ASSEMBLY COST CALCULATOR ====================
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

async function recalcAssemblyCost() {
  const numBoards = parseInt(document.getElementById('numBoardsInput').value) || 10;
  const costPerPad = parseFloat(document.getElementById('costPerPadInput').value) || 0.35;
  const stencil = document.getElementById('stencilSelect').value;
  const isDouble = stencil === 'double';

  state.assembly.numBoards = numBoards;
  state.assembly.costPerPad = costPerPad;
  state.assembly.stencil = stencil;

  try {
    const payload = {
      num_boards: numBoards,
      cost_per_pad: costPerPad,
      smd_pads: state.gerber.smdTotal || 1317,
      tht_pads: state.gerber.thtPins || 178,
      assembly_type: state.assembly.type,
      complexity_score: state.gerber.complexityScore || 50.0,
      is_double_sided: isDouble,
      currency: state.currency
    };

    const res = await fetch('/api/calculate-assembly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      applyAssemblyResults(data);
    }
  } catch (err) {
    console.error('Calculation error:', err);
  }
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

// ==================== BOM PARSING & SOURCING ====================
async function uploadBomFile(file) {
  document.getElementById('bomStatusTitle').innerText = 'Parsing Bill of Materials...';
  document.getElementById('bomStatusSub').innerText = file.name;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/parse-bom', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (res.ok) {
      applyBomData(data);
      showToast('BOM parsed successfully! Click "Source All Parts" to find lowest prices.');
    } else {
      alert('Error parsing BOM: ' + (data.detail || 'Unknown error'));
    }
  } catch (err) {
    alert('Upload error: ' + err.message);
  } finally {
    document.getElementById('bomStatusTitle').innerText = 'Upload Bill of Materials (BOM)';
    document.getElementById('bomStatusSub').innerText = 'Supports KiCad, Altium, Eagle, or Custom Excel / CSV BOM files';
  }
}

async function loadSampleBom() {
  document.getElementById('bomStatusTitle').innerText = 'Loading Sample BOM...';
  try {
    const res = await fetch('/api/sample-bom');
    const data = await res.json();
    if (res.ok) {
      applyBomData(data);
      showToast('Sample BOM (AX60 Audiometer) loaded! Ready to source.');
    }
  } catch (err) {
    console.error('Failed to load sample BOM:', err);
  } finally {
    document.getElementById('bomStatusTitle').innerText = 'Upload Bill of Materials (BOM)';
  }
}

function applyBomData(data) {
  state.bom.loaded = true;
  state.bom.filename = data.filename || 'BOM.csv';
  state.bom.rawItems = data.items || [];
  state.bom.totalLineItems = data.total_line_items || 0;
  state.bom.totalComponents = data.total_components || 0;

  document.getElementById('dispBomLineCount').innerText = `${state.bom.totalLineItems} Lines`;
  document.getElementById('dispBomTotalComponents').innerText = `${state.bom.totalComponents} total components`;

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
  showToast('BOM loaded! Select preferred websites below and click "Sourcing All Parts".');
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

    tr.innerHTML = `
      <td>${it.id || idx + 1}</td>
      <td class="cell-designator" title="${escapeHtml(it.designator || '')}"><strong>${escapeHtml(it.designator || '--')}</strong></td>
      <td class="cell-desc" title="${escapeHtml(it.description || '')}">${escapeHtml(it.description || '--')}</td>
      <td class="cell-fp" title="${escapeHtml(it.footprint || '')}"><span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(it.footprint || '--')}</span></td>
      <td><strong>${it.quantity}</strong></td>
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
