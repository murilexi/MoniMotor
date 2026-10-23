// ==============================================================================
// MÓDULO 1: CONFIGURAÇÃO E INICIALIZAÇÃO DO FIREBASE
// ==============================================================================

const firebaseConfig = {
  apiKey: "AIzaSyDgv8TKtlN8cZaNhcrFtC9j1HM4gXUu06c",
  authDomain: "upx2---projeto.firebaseapp.com",
  databaseURL: "https://upx2---projeto-default-rtdb.firebaseio.com/",
  projectId: "upx2---projeto",
  storageBucket: "upx2---projeto.firebasestorage.app",
  messagingSenderId: "320149787397",
  appId: "1:320149787397:web:28b5b4fc62c85399079d6c",
  measurementId: "G-QYFFSXY1GT"
};

firebase.initializeApp(firebaseConfig);
const database = firebase.database();


// ==============================================================================
// MÓDULO 2: DIAGNÓSTICO E MONITOR DE CONEXÃO EM TEMPO REAL
// ==============================================================================

function monitorarStatusConexao() {
  const connectedRef = database.ref('.info/connected');
  
  connectedRef.on('value', (snap) => {
    if (snap.val() === true) {
      console.log("🟢 [FIREBASE]: Conexão estabelecida com sucesso!");
      atualizarStatusUI(true);
    } else {
      console.warn("🔴 [FIREBASE]: Desconectado do servidor.");
      atualizarStatusUI(false);
    }
  });
}

function atualizarStatusUI(isOnline) {
  const statusEl = document.getElementById('status-text');
  const badgeEl = document.getElementById('status-badge');
  
  if (statusEl && badgeEl) {
    if (isOnline) {
      statusEl.innerText = "Conectado ao Firebase";
      badgeEl.className = "badge online";
    } else {
      statusEl.innerText = "Desconectado";
      badgeEl.className = "badge offline";
    }
  }
}

monitorarStatusConexao();


// ==============================================================================
// MÓDULO 3: GRÁFICO MULTI-SENSOR COM CHART.JS
// ==============================================================================

const ctx = document.getElementById('graficoLeituras').getContext('2d');
const grafico = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Temperatura (°C)',
        data: [],
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.05)',
        borderWidth: 2,
        fill: false,
        tension: 0.3
      },
      {
        label: 'RPM',
        data: [],
        borderColor: '#4ade80',
        backgroundColor: 'rgba(74, 222, 128, 0.05)',
        borderWidth: 2,
        fill: false,
        tension: 0.3
      },
      {
        label: 'Corrente (A)',
        data: [],
        borderColor: '#facc15',
        backgroundColor: 'rgba(250, 204, 21, 0.05)',
        borderWidth: 2,
        fill: false,
        tension: 0.3
      },
      {
        label: 'Aceleração Z',
        data: [],
        borderColor: '#f87171',
        backgroundColor: 'rgba(248, 113, 113, 0.05)',
        borderWidth: 2,
        fill: false,
        tension: 0.3
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } },
      y: { grid: { color: '#334155' }, ticks: { color: '#94a3b8' } }
    },
    plugins: {
      legend: { labels: { color: '#f8fafc' } }
    }
  }
});


// ==============================================================================
// MÓDULO 4: ESCUTAR DADOS DO ESP32 EM TEMPO REAL
// ==============================================================================

function escutarLeiturasEmTempoReal() {
  const leiturasRef = database.ref('leituras').limitToLast(20);

  leiturasRef.on('value', (snapshot) => {
    const dados = snapshot.val();
    if (!dados) return;

    const labels = [];
    const arrTemp = [];
    const arrRpm = [];
    const arrCorrente = [];
    const arrAcel = [];
    let ultimoDado = null;

    Object.keys(dados).forEach((key) => {
      const item = dados[key];
      const horaFormatada = item.timestamp
        ? new Date(item.timestamp).toLocaleTimeString('pt-BR')
        : '--:--:--';

      labels.push(horaFormatada);
      arrTemp.push(item.temperatura || 0);
      arrRpm.push(item.rpm || 0);
      arrCorrente.push(item.corrente || 0);
      arrAcel.push(item.acel_z || 0);

      ultimoDado = { ...item, hora: horaFormatada };
    });

    // 1. Atualiza o Gráfico
    grafico.data.labels = labels;
    grafico.data.datasets[0].data = arrTemp;
    grafico.data.datasets[1].data = arrRpm;
    grafico.data.datasets[2].data = arrCorrente;
    grafico.data.datasets[3].data = arrAcel;
    grafico.update();

    // 2. Atualiza os Cartões Superiores
    if (ultimoDado) {
      document.getElementById('val-temp').innerText = ultimoDado.temperatura !== undefined ? ultimoDado.temperatura.toFixed(1) : '--';
      document.getElementById('time-temp').innerText = ultimoDado.hora;

      document.getElementById('val-rpm').innerText = ultimoDado.rpm !== undefined ? ultimoDado.rpm : '--';
      document.getElementById('time-rpm').innerText = ultimoDado.hora;

      document.getElementById('val-corrente').innerText = ultimoDado.corrente !== undefined ? ultimoDado.corrente.toFixed(2) : '--';
      document.getElementById('time-corrente').innerText = ultimoDado.hora;

      document.getElementById('val-acel').innerText = ultimoDado.acel_z !== undefined ? ultimoDado.acel_z.toFixed(1) : '--';
      document.getElementById('time-acel').innerText = ultimoDado.hora;
    }
  });
}

// Inicia a escuta
escutarLeiturasEmTempoReal();