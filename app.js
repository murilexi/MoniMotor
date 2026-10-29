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

let ultimoTempoRecebimento = 0;
const TIMEOUT_LIMITE_MS = 5000;

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
// GRÁFICO
// ==============================================================================

const ctx = document.getElementById('graficoLeituras').getContext('2d');
const grafico = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      { label: 'Temp. (°C)', data: [], borderColor: '#0099ff', borderWidth: 2, pointRadius: 0, tension: 0.1 },
      { label: 'RPM', data: [], borderColor: '#00e676', borderWidth: 2, pointRadius: 0, tension: 0.1 },
      { label: 'Corrente (A)', data: [], borderColor: '#ffb300', borderWidth: 2, pointRadius: 0, tension: 0.1 },
      { label: 'Vibração (m/s²)', data: [], borderColor: '#ff3333', borderWidth: 2, pointRadius: 0, tension: 0.1 }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { color: '#1a1a1a' }, ticks: { color: '#666666', font: { family: 'Fira Code', size: 10 } } },
      y: { grid: { color: '#1a1a1a' }, ticks: { color: '#666666', font: { family: 'Fira Code', size: 10 } } }
    },
    plugins: { legend: { labels: { color: '#cccccc', font: { family: 'Plus Jakarta Sans', size: 11 } } } }
  }
});

// ==============================================================================
// MOTOR DE DIAGNÓSTICO
// ==============================================================================

function analisarSaudeDoMotor(dado) {
  const diagnosticos = [];
  let nivelMaximo = 'ok';

  const temp = dado.temperatura ?? 0;
  const corrente = dado.corrente ?? 0;
  const vibracao = dado.vibracao_pico_z ?? dado.acel_z ?? 0;

  if (temp > 90) {
    nivelMaximo = 'danger';
    diagnosticos.push({
      nivel: 'danger',
      titulo: 'ALERTA: SOBREAQUECIMENTO CRÍTICO (> 90°C)',
      causa: 'Risco de degradação do isolamento térmico do estator.',
      acao: 'Interromper operação. Verificar ventilação e obstruções físicas.'
    });
  } else if (temp > 75) {
    if (nivelMaximo !== 'danger') nivelMaximo = 'warning';
    diagnosticos.push({
      nivel: 'warning',
      titulo: 'ATENÇÃO: TEMPERATURA ELEVADA (> 75°C)',
      causa: 'Acúmulo térmico acima da média.',
      acao: 'Inspecionar fluxo de ar e sujeira acumulada nas aletas.'
    });
  }

  if (corrente > 15.0) {
    nivelMaximo = 'danger';
    diagnosticos.push({
      nivel: 'danger',
      titulo: 'ALERTA: SOBRECORRENTE ELÉTRICA (> 15A)',
      causa: 'Esforço mecânico excessivo ou travamento de fase.',
      acao: 'Verificar alinhamento do acoplamento e medir tensão nas fases.'
    });
  } else if (corrente > 10.0) {
    if (nivelMaximo !== 'danger') nivelMaximo = 'warning';
    diagnosticos.push({
      nivel: 'warning',
      titulo: 'ATENÇÃO: CONSUMO ACIMA DA MEDIA (> 10A)',
      causa: 'Resistência mecânica aumentada na carga.',
      acao: 'Lubrificar rolamentos e verificar estado do acoplamento.'
    });
  }

  if (vibracao > 7.1) {
    nivelMaximo = 'danger';
    diagnosticos.push({
      nivel: 'danger',
      titulo: 'ALERTA: VIBRAÇÃO CRÍTICA ISO 10816 (> 7.1 m/s²)',
      causa: 'Desalinhamento severo do eixo ou danos no rolamento.',
      acao: 'Parar máquina para alinhamento a laser e inspeção mecânica.'
    });
  } else if (vibracao > 4.5) {
    if (nivelMaximo !== 'danger') nivelMaximo = 'warning';
    diagnosticos.push({
      nivel: 'warning',
      titulo: 'ATENÇÃO: ELEVAÇÃO DE VIBRAÇÃO (> 4.5 m/s²)',
      causa: 'Fixação solta na base ou início de desgaste.',
      acao: 'Reapertar parafusos da base e monitorar curva de aceleração.'
    });
  }

  if (diagnosticos.length === 0) {
    diagnosticos.push({
      nivel: 'ok',
      titulo: 'SISTEMA OPERANDO DENTRO DOS LIMITES',
      causa: 'Todos os parâmetros elétricos e dinâmicos dentro das especificações.',
      acao: 'Manter cronograma de manutenção preventiva padrão.'
    });
  }

  atualizarPainelDiagnostico(diagnosticos, nivelMaximo);
}

function atualizarPainelDiagnostico(lista, nivelMax) {
  const container = document.getElementById('diagnostic-container');
  const badgeHealth = document.getElementById('health-badge');
  const textHealth = document.getElementById('health-text');
  const countText = document.getElementById('diagnostic-count');

  if (nivelMax === 'danger') {
    badgeHealth.className = 'badge health-danger';
    textHealth.innerText = 'Risco / Parada Requerida';
  } else if (nivelMax === 'warning') {
    badgeHealth.className = 'badge health-warning';
    textHealth.innerText = 'Atenção Preditiva';
  } else {
    badgeHealth.className = 'badge health-ok';
    textHealth.innerText = 'Motor Operacional';
  }

  countText.innerText = `${lista.length} ${lista.length === 1 ? 'análise ativa' : 'análises ativas'}`;

  container.innerHTML = lista.map(item => `
    <div class="diag-card ${item.nivel}">
      <div class="diag-title">${item.titulo}</div>
      <div class="diag-desc"><strong>Diagnóstico:</strong> ${item.causa}</div>
      <div class="diag-action"><strong>Ação Recomendada:</strong> ${item.acao}</div>
    </div>
  `).join('');
}

function tratarMotorDesligadoOuSemSinal(mensagemStatus) {
  const badgeHealth = document.getElementById('health-badge');
  const textHealth = document.getElementById('health-text');
  const countText = document.getElementById('diagnostic-count');
  const container = document.getElementById('diagnostic-container');

  badgeHealth.className = 'badge health-unknown';
  textHealth.innerText = mensagemStatus;
  countText.innerText = 'Sem medições operacionais';

  container.innerHTML = `
    <div class="diag-card">
      <div class="diag-title" style="color: var(--text-muted);">${mensagemStatus.toUpperCase()}</div>
      <div class="diag-desc">O ativo não apresenta rotação/corrente ou a transmissão de dados está inativa.</div>
      <div class="diag-action">Diagnósticos ativados automaticamente com a inicialização da telemetria.</div>
    </div>
  `;
}

// ==============================================================================
// TEMPO REAL
// ==============================================================================

function escutarLeiturasEmTempoReal() {
  const leiturasRef = database.ref('leituras').limitToLast(20);

  leiturasRef.on('value', (snapshot) => {
    const dados = snapshot.val();
    if (!dados) {
      tratarMotorDesligadoOuSemSinal("Sem dados no sistema");
      return;
    }

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

    ultimoTempoRecebimento = Date.now();

    grafico.data.labels = labels;
    grafico.data.datasets[0].data = arrTemp;
    grafico.data.datasets[1].data = arrRpm;
    grafico.data.datasets[2].data = arrCorrente;
    grafico.data.datasets[3].data = arrVib;
    grafico.update();

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

      const rpmAtual = ultimoDado.rpm ?? 0;
      const correnteAtual = ultimoDado.corrente ?? 0;

      if (rpmAtual === 0 && correnteAtual === 0) {
        tratarMotorDesligadoOuSemSinal("Motor Desligado");
      } else {
        analisarSaudeDoMotor(ultimoDado);
      }
    }
  });
}

setInterval(() => {
  if (ultimoTempoRecebimento > 0 && (Date.now() - ultimoTempoRecebimento > TIMEOUT_LIMITE_MS)) {
    tratarMotorDesligadoOuSemSinal("Sinal Interrompido");
  }
}, 2000);

escutarLeiturasEmTempoReal();