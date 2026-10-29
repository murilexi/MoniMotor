// ==============================================================================
// CONFIGURAÇÃO DO FIREBASE
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
// MONITOR DE CONEXÃO
// ==============================================================================

function monitorarStatusConexao() {
  const connectedRef = database.ref('.info/connected');
  connectedRef.on('value', (snap) => {
    const isOnline = snap.val() === true;
    const statusEl = document.getElementById('status-text');
    const badgeEl = document.getElementById('status-badge');
    if (statusEl && badgeEl) {
      statusEl.innerText = isOnline ? "Online" : "Desconectado";
      badgeEl.className = isOnline ? "badge online" : "badge offline";
    }
  });
}

monitorarStatusConexao();

// ==============================================================================
// GRÁFICO COM CHART.JS
// ==============================================================================

const ctx = document.getElementById('graficoLeituras').getContext('2d');
const grafico = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'Temperatura (°C)', data: [], borderColor: '#38bdf8', borderWidth: 2, fill: false, tension: 0.3 },
      { label: 'RPM', data: [], borderColor: '#34d399', borderWidth: 2, fill: false, tension: 0.3 },
      { label: 'Corrente (A)', data: [], borderColor: '#fbbf24', borderWidth: 2, fill: false, tension: 0.3 },
      { label: 'Vibração (m/s²)', data: [], borderColor: '#f87171', borderWidth: 2, fill: false, tension: 0.3 }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { family: 'JetBrains Mono' } } },
      y: { grid: { color: '#1e293b' }, ticks: { color: '#64748b', font: { family: 'JetBrains Mono' } } }
    },
    plugins: { legend: { labels: { color: '#f1f5f9' } } }
  }
});

// ==============================================================================
// MOTOR DE DIAGNÓSTICO PREDITIVO
// ==============================================================================

function analisarSaudeDoMotor(dado) {
  const diagnósticos = [];
  let nivelMaximo = 'ok'; // 'ok', 'warning', 'danger'

  const temp = dado.temperatura ?? 0;
  const rpm = dado.rpm ?? 0;
  const corrente = dado.corrente ?? 0;
  const vibracao = dado.vibracao_pico_z ?? dado.acel_z ?? 0;

  // 1. ANÁLISE DE TEMPERATURA
  if (temp > 90) {
    nivelMaximo = 'danger';
    diagnósticos.push({
      nivel: 'danger',
      titulo: '🚨 Alerta Crítico: Sobreaquecimento Severo (> 90°C)',
      causa: 'Risco iminente de queima do isolamento dos enrolamentos do estator.',
      acao: 'AÇÃO PREVENTIVA: Desligue o motor para resfriamento. Inspecione a ventoinha traseira, desobstrua as aletas da carcaça e meça a corrente.'
    });
  } else if (temp > 75) {
    if (nivelMaximo !== 'danger') nivelMaximo = 'warning';
    diagnósticos.push({
      nivel: 'warning',
      titulo: '⚠️ Atenção: Temperatura Elevada (> 75°C)',
      causa: 'Ventilação deficiente ou motor operando próximo ao fator de serviço limite.',
      acao: 'AÇÃO PREVENTIVA: Checar se a carcaça está coberta de poeira e se a temperatura ambiente está muito alta.'
    });
  }

  // 2. ANÁLISE DE CORRENTE
  if (corrente > 15.0) {
    nivelMaximo = 'danger';
    diagnósticos.push({
      nivel: 'danger',
      titulo: '🚨 Alerta Crítico: Sobrecorrente Detectada (> 15A)',
      causa: 'Sobrecarga mecânica grave, trava parcial do eixo ou falha de isolamento de fase.',
      acao: 'AÇÃO PREVENTIVA: Verificar se a carga acoplada travou ou se há queda de tensão na alimentação elétrica.'
    });
  } else if (corrente > 10.0) {
    if (nivelMaximo !== 'danger') nivelMaximo = 'warning';
    diagnósticos.push({
      nivel: 'warning',
      titulo: '⚠️ Atenção: Consumo Elétrico Acima do Normal (> 10A)',
      causa: 'Aumento na resistência mecânica da carga ou pequeno desalinhamento.',
      acao: 'AÇÃO PREVENTIVA: Inspecionar o alinhamento das polias/acoplamentos e a lubrificação mecânica.'
    });
  }

  // 3. ANÁLISE DE VIBRAÇÃO (ISO 10816)
  if (vibracao > 7.1) {
    nivelMaximo = 'danger';
    diagnósticos.push({
      nivel: 'danger',
      titulo: '🚨 Alerta Crítico: Vibração Excessiva - Zona D ISO 10816 (> 7.1 m/s²)',
      causa: 'Desalinhamento grave do eixo, desbalanceamento severo ou desgaste crítico de rolamento.',
      acao: 'AÇÃO PREVENTIVA: Risco de danos estruturais. Interrompa a operação, efetue alinhamento a laser e verifique folgas em rolamentos.'
    });
  } else if (vibracao > 4.5) {
    if (nivelMaximo !== 'danger') nivelMaximo = 'warning';
    diagnósticos.push({
      nivel: 'warning',
      titulo: '⚠️ Atenção: Vibração Anormal - Zona C ISO 10816 (> 4.5 m/s²)',
      causa: 'Parafusos de fixação (Pé Manco) soltos ou início de desgaste de rolamento.',
      acao: 'AÇÃO PREVENTIVA: Programar reaperto dos parafusos da base e relubrificação dos rolamentos.'
    });
  }

  // 4. ANÁLISE DE ROTAÇÃO (RPM)
  if (rpm > 0 && rpm < 1000) {
    if (nivelMaximo !== 'danger') nivelMaximo = 'warning';
    diagnósticos.push({
      nivel: 'warning',
      titulo: '⚠️ Atenção: Rotação Abaixo da Nominal (< 1000 RPM)',
      causa: 'Escorregamento excessivo, correia de transmissão frouxa/patinando ou carga muito pesada.',
      acao: 'AÇÃO PREVENTIVA: Esticar ou substituir as correias de transmissão e inspecionar a carga acoplada.'
    });
  }

  // Se nenhum problema for detectado
  if (diagnósticos.length === 0) {
    diagnósticos.push({
      nivel: 'ok',
      titulo: '✅ Todos os Parâmetros Normais',
      causa: 'O motor está operando dentro dos limites seguros de temperatura, corrente, rotação e vibração.',
      acao: 'Nenhuma ação corretiva necessária no momento. Manter rotina de inspeção periódica.'
    });
  }

  atualizarPainelDiagnostico(diagnósticos, nivelMaximo);
}

function atualizarPainelDiagnostico(lista, nivelMax) {
  const container = document.getElementById('diagnostic-container');
  const badgeHealth = document.getElementById('health-badge');
  const textHealth = document.getElementById('health-text');
  const countText = document.getElementById('diagnostic-count');

  // Atualiza Badge de Saúde do Motor
  if (nivelMax === 'danger') {
    badgeHealth.className = 'badge health-danger';
    textHealth.innerText = '🚨 Risco / Ação Requerida';
  } else if (nivelMax === 'warning') {
    badgeHealth.className = 'badge health-warning';
    textHealth.innerText = '⚠️ Atenção Preditiva';
  } else {
    badgeHealth.className = 'badge health-ok';
    textHealth.innerText = '✅ Motor Operacional';
  }

  countText.innerText = `${lista.length} ${lista.length === 1 ? 'status analisado' : 'diagnósticos ativos'}`;

  // Renderiza os Cards de Diagnóstico
  container.innerHTML = lista.map(item => `
    <div class="diag-card ${item.nivel}">
      <div class="diag-title">${item.titulo}</div>
      <div class="diag-desc"><strong>Origem Provável:</strong> ${item.causa}</div>
      <div class="diag-action"><strong>🔧 Ação Corretiva Recomendada:</strong> ${item.acao}</div>
    </div>
  `).join('');
}

// ==============================================================================
// ESCUTAR DADOS EM TEMPO REAL
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
    const arrVib = [];
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
      arrVib.push(item.vibracao_pico_z ?? item.acel_z ?? 0);

      ultimoDado = { ...item, hora: horaFormatada };
    });

    // 1. Atualiza Gráfico
    grafico.data.labels = labels;
    grafico.data.datasets[0].data = arrTemp;
    grafico.data.datasets[1].data = arrRpm;
    grafico.data.datasets[2].data = arrCorrente;
    grafico.data.datasets[3].data = arrVib;
    grafico.update();

    // 2. Atualiza Valores nos Cards
    if (ultimoDado) {
      document.getElementById('val-temp').innerText = ultimoDado.temperatura !== undefined ? Number(ultimoDado.temperatura).toFixed(1) : '--';
      document.getElementById('time-temp').innerText = ultimoDado.hora;

      document.getElementById('val-rpm').innerText = ultimoDado.rpm !== undefined ? ultimoDado.rpm : '--';
      document.getElementById('time-rpm').innerText = ultimoDado.hora;

      document.getElementById('val-corrente').innerText = ultimoDado.corrente !== undefined ? Number(ultimoDado.corrente).toFixed(2) : '--';
      document.getElementById('time-corrente').innerText = ultimoDado.hora;

      const vVal = ultimoDado.vibracao_pico_z ?? ultimoDado.acel_z;
      document.getElementById('val-acel').innerText = vVal !== undefined ? Number(vVal).toFixed(2) : '--';
      document.getElementById('time-acel').innerText = ultimoDado.hora;

      // Executa Análise Preditiva
      analisarSaudeDoMotor(ultimoDado);
    }
  });
}

escutarLeiturasEmTempoReal();