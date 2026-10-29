// ==============================================================================
// ESCUTAR DADOS EM TEMPO REAL E CONTROLE DE TIMEOUT
// ==============================================================================

let ultimoTempoRecebimento = 0;
const TIMEOUT_LIMITE_MS = 5000; // 5 segundos sem dados = motor desligado ou sem sinal

function escutarLeiturasEmTempoReal() {
  const leiturasRef = database.ref('leituras').limitToLast(20);

  leiturasRef.on('value', (snapshot) => {
    const dados = snapshot.val();
    if (!dados) {
      tratarMotorDesligadoOuSemSinal("Sem dados no Firebase");
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

    // Atualiza o timestamp da última recepção bem-sucedida
    ultimoTempoRecebimento = Date.now();

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

      // Verifica se o motor está realmente rodando ou desligado (RPM e Corrente zerados)
      const rpmAtual = ultimoDado.rpm ?? 0;
      const correnteAtual = ultimoDado.corrente ?? 0;

      if (rpmAtual === 0 && correnteAtual === 0) {
        tratarMotorDesligadoOuSemSinal("Motor Desligado");
      } else {
        // Executa Análise Preditiva Normal se estiver ligado
        analisarSaudeDoMotor(ultimoDado);
      }
    }
  });
}

function tratarMotorDesligadoOuSemSinal(mensagemStatus) {
  const badgeHealth = document.getElementById('health-badge');
  const textHealth = document.getElementById('health-text');
  const countText = document.getElementById('diagnostic-count');
  const container = document.getElementById('diagnostic-container');

  badgeHealth.className = 'badge health-warning';
  textHealth.innerText = `💤 ${mensagemStatus}`;
  countText.innerText = 'Nenhuma atividade elétrica/mecânica';

  container.innerHTML = `
    <div class="diag-card warning">
      <div class="diag-title">💤 Sistema em Repouso ou Sem Comunicação</div>
      <div class="diag-desc">O motor encontra-se desligado (RPM e Corrente zerados) ou o ESP32 perdeu a conexão com o banco de dados.</div>
      <div class="diag-action"><strong>ℹ️ Info:</strong> Os diagnósticos preditivos serão ativados automaticamente assim que o motor entrar em funcionamento.</div>
    </div>
  `;
}

// Verificador contínuo de tempo sem receber dados (Caso o ESP32 trave ou desligue abruptamente)
setInterval(() => {
  if (ultimoTempoRecebimento > 0 && (Date.now() - ultimoTempoRecebimento > TIMEOUT_LIMITE_MS)) {
    tratarMotorDesligadoOuSemSinal("Sem Sinal do ESP32");
  }
}, 2000);

escutarLeiturasEmTempoReal();