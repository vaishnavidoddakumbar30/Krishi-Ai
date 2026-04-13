/* KrishiAI — App JS */

// ── State ──
let currentLang = 'en';
let currentWeather = null;
let chatHistory = [];
let weatherChart = null;
let activeAdviceText = '';

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  setupDrag();
  setupCursor();
});

// ── Cursor ──
function setupCursor() {
  const crsr = document.getElementById('crsr');
  if (!crsr) return;
  document.addEventListener('mousemove', e => {
    crsr.style.left = e.clientX + 'px';
    crsr.style.top = e.clientY + 'px';
  });
  document.querySelectorAll('button, input, select, a, .nav-item, .hist-item, .feat').forEach(el => {
    el.addEventListener('mouseenter', () => { crsr.style.width = '18px'; crsr.style.height = '18px'; });
    el.addEventListener('mouseleave', () => { crsr.style.width = '8px'; crsr.style.height = '8px'; });
  });
}

// ── Page Navigation ──
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelector(`[data-page="${name}"]`)?.classList.add('active');
  const titles = {
    advisor: 'Farming Advisor',
    disease: 'Disease Detection',
    chat: 'AI Chatbot',
    history: 'My History'
  };
  const el = document.getElementById('pageTitle');
  if (el) el.textContent = titles[name] || '';
  if (name === 'history') loadHistory();
  if (window.innerWidth <= 760) {
    document.getElementById('sidebar')?.classList.remove('open');
  }
}

// ── Language ──
function setLang(lang) { currentLang = lang; }

// ── Toast ──
function toast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show${type ? ' ' + type : ''}`;
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// ── Auto Locate ──
function autoLocate() {
  if (!navigator.geolocation) { toast('Geolocation not supported', 'error'); return; }
  toast('Detecting your location…');
  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude.toFixed(4);
    const lon = pos.coords.longitude.toFixed(4);
    const el = document.getElementById('locationInput');
    el.value = `${lat}, ${lon}`;
    el.dataset.lat = lat; el.dataset.lon = lon;
    toast('Location detected ✓', 'success');
  }, () => toast('Could not detect location', 'error'));
}

// ── Fetch Weather ──
async function fetchWeather(location, lat, lon) {
  let url = '/weather?';
  if (lat && lon) url += `lat=${lat}&lon=${lon}`;
  else url += `location=${encodeURIComponent(location)}`;
  const r = await fetch(url);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Weather unavailable');
  return d;
}

// ── Get Advice ──
async function getAdvice() {
  const crop = document.getElementById('cropInput').value.trim();
  const locEl = document.getElementById('locationInput');
  const location = locEl.value.trim();
  const lat = locEl.dataset.lat;
  const lon = locEl.dataset.lon;

  if (!crop) { toast('Please enter a crop name', 'error'); return; }

  const btn = document.getElementById('adviceBtn');
  const btnTxt = document.getElementById('adviceBtn-text');
  btn.disabled = true;
  btnTxt.innerHTML = '<span class="spinner"></span>Fetching weather…';

  try {
    let weather = null;
    if (location || (lat && lon)) {
      try {
        weather = await fetchWeather(location, lat, lon);
        currentWeather = weather;
        renderWeather(weather);
        document.getElementById('weatherCard').style.display = 'block';
        const wb = document.getElementById('weatherBadge');
        if (wb) wb.textContent = `${weather.city} · ${weather.temp}°C · ${weather.description}`;
      } catch (e) {
        toast('Weather unavailable, continuing…', 'error');
      }
    }

    btnTxt.innerHTML = '<span class="spinner"></span>Generating AI advice…';

    const r = await fetch('/get-advice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ crop, location, weather, language: currentLang })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);

    activeAdviceText = d.advice;
    document.getElementById('adviceText').textContent = d.advice;
    document.getElementById('adviceCard').style.display = 'block';
    toast('Advice ready! 🌾', 'success');
    document.getElementById('adviceCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btnTxt.textContent = '✨ Get AI Advice';
  }
}

// ── Render Weather ──
function renderWeather(w) {
  const d = document.getElementById('weatherDisplay');
  d.innerHTML = `
    <div class="wstat"><div class="val">${w.temp}°C</div><div class="lbl">Temperature</div></div>
    <div class="wstat"><div class="val">${w.feels_like}°C</div><div class="lbl">Feels Like</div></div>
    <div class="wstat"><div class="val">${w.humidity}%</div><div class="lbl">Humidity</div></div>
    <div class="wstat"><div class="val">${w.wind_speed}m/s</div><div class="lbl">Wind</div></div>
    <div class="wstat"><div class="val">${w.rain || 0}mm</div><div class="lbl">Rain/hr</div></div>
    <div class="wstat wide"><div class="val" style="font-size:.95rem">${w.city}, ${w.country}</div><div class="lbl">${w.description}</div></div>
  `;

  if (w.forecast?.length) {
    const labels = w.forecast.map(f =>
      new Date(f.time.replace(" ", "T") + "Z").toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })
    );
    const temps  = w.forecast.map(f => f.temp);
    const hums   = w.forecast.map(f => f.humidity);
    const rains = w.forecast.map(f => (f.pop || 0) * 100);
    
    const ctx    = document.getElementById('weatherChart').getContext('2d');
    
    if (rains.every(r => r === 0)) {
      console.log("No rain expected 🌤️");
    }

    if (rains.some(r => r > 60)) {
      console.log("⚠️ High chance of rain!");
    }
    
    if (weatherChart) weatherChart.destroy();
    weatherChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Temp °C', data: temps,
            borderColor: '#d4a557', backgroundColor: 'rgba(196,146,58,0.12)',
            tension: 0.4, fill: true, yAxisID: 'y', pointRadius: 3,
            pointBackgroundColor: '#d4a557',
          },
          {
            label: 'Humidity %', data: hums,
            borderColor: '#3d5828', backgroundColor: 'rgba(61,88,40,0.15)',
            tension: 0.4, fill: true, yAxisID: 'y1', pointRadius: 3,
            pointBackgroundColor: '#6b7f50',
          },

          {
            label: 'Rain %', data: rains,
            borderColor: '#1195d2', backgroundColor: 'rgba(61,88,40,0.15)',
            tension: 0.4, fill: true, yAxisID: 'y2', pointRadius: 3,
            pointBackgroundColor: '#1195d2',
          }
        ]
      },
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: 'rgba(240,232,213,0.6)', font: { size: 11, family: 'Jost' } } }
        },
        scales: {
          x: {
            ticks: { color: 'rgba(240,232,213,0.4)', font: { size: 10 } },
            grid: { color: 'rgba(196,146,58,0.06)' }
          },
          y: {
            type: 'linear', position: 'left',
            ticks: { color: 'rgba(240,232,213,0.4)', font: { size: 10 } },
            grid: { color: 'rgba(196,146,58,0.06)' }
          },
          y1: {
            type: 'linear', position: 'right',
            ticks: { color: 'rgba(240,232,213,0.4)', font: { size: 10 } },
            grid: { drawOnChartArea: false }
          },y2: {
            type: 'linear',
            position: 'right',ticks: { color: 'rgba(240,232,213,0.4)', font: { size: 10 } },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }
}

// ── Speak ──
function speakAdvice() { speakText(activeAdviceText); }
function speakEl(id) { speakText(document.getElementById(id)?.textContent || ''); }
function speakText(text) {
  if (!text) { toast('Nothing to read', 'error'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.slice(0, 2500));
  const lmap = { en: 'en-US', hi: 'hi-IN', kn: 'kn-IN' };
  u.lang = lmap[currentLang] || 'en-US';
  u.rate = 0.88;
  window.speechSynthesis.speak(u);
  toast('🔊 Reading aloud…');
}

// ── Voice Input ──
function startVoice(inputId) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('Voice not supported in this browser', 'error'); return; }
  const rec = new SR();
  const lmap = { en: 'en-US', hi: 'hi-IN', kn: 'kn-IN' };
  rec.lang = lmap[currentLang] || 'en-US';
  rec.interimResults = false;

  const btns = document.querySelectorAll('.mic-btn, .cb-mic');
  btns.forEach(b => b.classList.add('listening'));
  toast('🎤 Listening…');

  rec.onresult = e => {
    const el = document.getElementById(inputId);
    if (el) el.value = e.results[0][0].transcript;
    btns.forEach(b => b.classList.remove('listening'));
    toast('Voice captured ✓', 'success');
  };
  rec.onerror = () => { btns.forEach(b => b.classList.remove('listening')); toast('Voice input failed', 'error'); };
  rec.onend = () => btns.forEach(b => b.classList.remove('listening'));
  rec.start();
}

// ── Image Upload ──
function handleImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const preview = document.getElementById('imagePreview');
  preview.src = URL.createObjectURL(file);
  preview.style.display = 'block';
  document.getElementById('analyzeBtn').style.display = 'block';
}

function setupDrag() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const dt = new DataTransfer(); dt.items.add(file);
      document.getElementById('imageInput').files = dt.files;
      handleImageUpload({ target: { files: [file] } });
    }
  });
}

async function analyzeImage() {
  const fi = document.getElementById('imageInput');
  const crop = document.getElementById('diseaseCrop').value.trim() || 'plant';
  if (!fi.files[0]) { toast('No image selected', 'error'); return; }

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true; btn.textContent = '⏳ Analysing…';

  const fd = new FormData();
  fd.append('image', fi.files[0]);
  fd.append('crop', crop);
  fd.append('language', currentLang);

  try {
    const r = await fetch('/upload-image', { method: 'POST', body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    document.getElementById('diseaseText').textContent = d.analysis;
    document.getElementById('diseaseResult').style.display = 'block';
    document.getElementById('diseaseResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    toast('Analysis complete! 🔬', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '🧬 Analyse Disease';
  }
}

// ── Chat ──
async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  await quickChat(msg);
}

async function quickChat(msg) {
  const msgs = document.getElementById('chatMessages');
  const welcome = msgs.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  msgs.innerHTML += `<div class="chat-bubble user">${esc(msg)}</div>`;
  const tid = 'typing-' + Date.now();
  msgs.innerHTML += `<div class="chat-bubble bot typing" id="${tid}">✦ ✦ ✦</div>`;
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const r = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, language: currentLang, history: chatHistory })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    document.getElementById(tid)?.remove();
    msgs.innerHTML += `<div class="chat-bubble bot">${esc(d.response)}</div>`;
    chatHistory.push({ user: msg, bot: d.response });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  } catch (e) {
    document.getElementById(tid)?.remove();
    msgs.innerHTML += `<div class="chat-bubble bot" style="color:#ff9090">${esc(e.message)}</div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── History ──
async function loadHistory() {
  const c = document.getElementById('historyList');
  c.innerHTML = '<div class="empty-state">Loading…</div>';
  try {
    const r = await fetch('/history');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (!data.length) {
      c.innerHTML = '<div class="empty-state">No history yet — get some farming advice first! 🌱</div>';
      return;
    }
    c.innerHTML = data.map(item => `
      <div class="hist-item" id="h${item.id}">
        <div class="hist-meta">
          <span class="hist-crop">🌱 ${esc(item.crop)}</span>
          <span class="hist-loc">📍 ${esc(item.location || '—')}</span>
          <span class="hist-time">${new Date(item.timestamp).toLocaleDateString()}</span>
          <button class="hist-del" onclick="deleteHistory(${item.id}, event)" title="Delete">✕</button>
        </div>
        <div class="hist-preview" onclick="toggleHist(${item.id})">${esc(item.advice.slice(0, 130))}…</div>
        <div class="hist-full" id="hf${item.id}">${esc(item.advice)}</div>
      </div>
    `).join('');
  } catch (e) {
    c.innerHTML = `<div class="empty-state" style="color:#ff9090">${esc(e.message)}</div>`;
  }
}

function toggleHist(id) {
  document.getElementById('hf' + id)?.classList.toggle('open');
}

async function deleteHistory(id, e) {
  e.stopPropagation();
  if (!confirm('Delete this history entry?')) return;
  const r = await fetch(`/history/${id}`, { method: 'DELETE' });
  if (r.ok) { document.getElementById('h' + id)?.remove(); toast('Deleted', 'success'); }
}

// ── Logout ──
async function doLogout() {
  await fetch('/logout', { method: 'POST' });
  window.location.reload();
}

// ── Util ──
function esc(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str || ''));
  return d.innerHTML;
}