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
      console.warn("🔴 [FIREBASE]: Desconectado do servidor. Tentando reconectar...");
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
// MÓDULO 3: FUNÇÃO DE ESCRITA NO BANCO (PLUG PERMANENTE)
// ==============================================================================

function gravarLeituraNoBanco(sensor1, sensor2) {
  const novoRegistro = {
    sensor_1: sensor1,
    sensor_2: sensor2,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };

  return database.ref('leituras').push(novoRegistro)
    .then((ref) => {
      console.log(`✅ [BANCO DE DADOS]: Dado gravado com sucesso! Chave: ${ref.key}`);
    })
    .catch((error) => {
      console.error("❌ [ERRO DE ESCRITA]: Falha ao gravar no Firebase:", error.message);
    });
}


// ==============================================================================
// MÓDULO 4: GRÁFICO E LEITURA DOS DADOS EM TEMPO REAL
// ==============================================================================

// Inicialização do Chart.js
const ctx = document.getElementById('graficoLeituras').getContext('2d');
const grafico = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Sensor 1',
        data: [],
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3
      },
      {
        label: 'Sensor 2',
        data: [],
        borderColor: '#4ade80',
        backgroundColor: 'rgba(74, 222, 128, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        grid: { color: '#334155' },
        ticks: { color: '#94a3b8' }
      },
      y: {
        grid: { color: '#334155' },
        ticks: { color: '#94a3b8' }
      }
    },
    plugins: {
      legend: {
        labels: { color: '#f8fafc' }
      }
    }
  }
});

/**
 * Escuta o nó /leituras no Firebase. Sempre que um novo dado for adicionado
 * (pelo simulador agora ou pelo ESP32 no futuro), a tela atualiza instantaneamente.
 */
function escutarLeiturasEmTempoReal() {
  const leiturasRef = database.ref('leituras').limitToLast(20);

  leiturasRef.on('value', (snapshot) => {
    const dados = snapshot.val();
    if (!dados) return;

    const labels = [];
    const dadosSensor1 = [];
    const dadosSensor2 = [];
    let ultimoDado = null;

    Object.keys(dados).forEach((key) => {
      const item = dados[key];
      const horaFormatada = item.timestamp
        ? new Date(item.timestamp).toLocaleTimeString('pt-BR')
        : '--:--:--';

      labels.push(horaFormatada);
      dadosSensor1.push(item.sensor_1);
      dadosSensor2.push(item.sensor_2);
      ultimoDado = { ...item, hora: horaFormatada };
    });

    // 1. Atualiza os dados do gráfico
    grafico.data.labels = labels;
    grafico.data.datasets[0].data = dadosSensor1;
    grafico.data.datasets[1].data = dadosSensor2;
    grafico.update();

    // 2. Atualiza os valores dos cards superiores
    if (ultimoDado) {
      const elValS1 = document.getElementById('val-sensor1');
      const elTimeS1 = document.getElementById('time-sensor1');
      const elValS2 = document.getElementById('val-sensor2');
      const elTimeS2 = document.getElementById('time-sensor2');

      if (elValS1) elValS1.innerText = ultimoDado.sensor_1;
      if (elTimeS1) elTimeS1.innerText = ultimoDado.hora;
      if (elValS2) elValS2.innerText = ultimoDado.sensor_2;
      if (elTimeS2) elTimeS2.innerText = ultimoDado.hora;
    }
  });
}

// Inicia a escuta em tempo real
escutarLeiturasEmTempoReal();


// ==============================================================================
// MÓDULO 5: GERADOR DE DADOS SIMULADOS
// ==============================================================================

let temporizadorSimulacao = null;

function iniciarSimulacao() {
  console.log("🚀 [SIMULADOR]: Gerador temporário iniciado (envio a cada 3s)...");

  temporizadorSimulacao = setInterval(() => {
    const tempSimulada = parseFloat((21 + Math.random() * 8).toFixed(1));
    const umidSimulada = parseFloat((50 + Math.random() * 20).toFixed(1));

    gravarLeituraNoBanco(tempSimulada, umidSimulada);
  }, 3000);
}

iniciarSimulacao();