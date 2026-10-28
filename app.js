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
    const isOnline = snap.val() === true;
    atualizarStatusUI(isOnline);
  });
}

function atualizarStatusUI(isOnline) {
  const statusEl = document.getElementById('status-text');
  const badgeEl = document.getElementById('status-badge');
  
  if (statusEl && badgeEl) {
    if (isOnline) {
      statusEl.innerText = "Online";
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
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 2
      },
      {
        label: 'RPM',
        data: [],
        borderColor: '#34d399',
        backgroundColor: 'rgba(52, 211, 153, 0.05)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 2
      },
      {
        label: 'Corrente (A)',
        data: [],
        borderColor: '#fbbf24',
        backgroundColor: 'rgba(251, 191, 36, 0.05)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 2
      },
      {
        label: 'Aceleração Z',
        data: [],
        borderColor: '#f87171',
        backgroundColor: 'rgba(248, 113, 113, 0.05)',
        borderWidth: 2.5,
        fill: true,
        tension: 0.35,
        pointRadius: 2
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { 
        grid: { color: 'rgba(51, 65, 85, 0.3)' }, 
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 11 } } 
      },
      y: { 
        grid: { color: 'rgba(51, 65, 85, 0.3)' }, 
        ticks: { color: '#64748b', font: { family: 'JetBrains Mono', size: 11 } } 
      }
    },
    plugins: {
      legend: { 
        labels: { color: '#f1f5f9', font: { family: 'Inter', size: 12 } } 
      }
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
        ? new Date(Number(item.timestamp)).toLocaleTimeString('pt-BR')
        : '--:--:--';

      labels.push(horaFormatada);
      arrTemp.push(item.temperatura ?? 0);
      arrRpm.push(item.rpm ?? 0);
      arrCorrente.push(item.corrente ?? 0);
      arrAcel.push(item.vibracao_pico_z ?? item.acel_z ?? 0);

      ultimoDado = { 
        temperatura: item.temperatura,
        rpm: item.rpm,
        corrente: item.corrente,
        acel: item.vibracao_pico_z ?? item.acel_z,
        hora: horaFormatada 
      };
    });

    // 1. Atualiza o Gráfico
    grafico.data.labels = labels;
    grafico.data.datasets[0].data = arrTemp;
    grafico.data.datasets[1].data = arrRpm;
    grafico.data.datasets[2].data = arrCorrente;
    grafico.data.datasets[3].data = arrAcel;
    grafico.update();

    // 2. Atualiza os Cartões Superiores com segurança
    if (ultimoDado) {
      document.getElementById('val-temp').innerText = ultimoDado.temperatura !== undefined ? Number(ultimoDado.temperatura).toFixed(1) : '--';
      document.getElementById('time-temp').innerText = ultimoDado.hora;

      document.getElementById('val-rpm').innerText = ultimoDado.rpm !== undefined ? ultimoDado.rpm : '--';
      document.getElementById('time-rpm').innerText = ultimoDado.hora;

      document.getElementById('val-corrente').innerText = ultimoDado.corrente !== undefined ? Number(ultimoDado.corrente).toFixed(2) : '--';
      document.getElementById('time-corrente').innerText = ultimoDado.hora;

      document.getElementById('val-acel').innerText = ultimoDado.acel !== undefined ? Number(ultimoDado.acel).toFixed(2) : '--';
      document.getElementById('time-acel').innerText = ultimoDado.hora;
    }
  });
}

// Inicia a escuta
escutarLeiturasEmTempoReal();