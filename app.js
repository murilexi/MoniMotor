
// ==============================================================================
// INICIALIZACAO FIREBASE
// ==============================================================================

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();

// ==============================================================================
// CONFIGURACOES
// ==============================================================================

const TIMEOUT_LIMITE_MS = 15000;
const QUANTIDADE_AMOSTRAS = 20;

let ultimoTempoRecebimento = null;
let estadoSinalAtual = "";
const inicioMonitoramento = Date.now();

// Limites experimentais do prototipo.
// Devem ser calibrados para o motor real.

const LIMITES = {
  temperaturaAtencao: 75,
  temperaturaCritica: 90,

  correnteAtencao: 10,
  correnteCritica: 15,

  vibracaoAtencao: 4.5,
  vibracaoCritica: 7.1
};

// ==============================================================================
// FUNCOES AUXILIARES
// ==============================================================================

function obterNumero(dado, campo) {

  if (
    !dado ||
    dado[campo] === undefined ||
    dado[campo] === null ||
    dado[campo] === ""
  ) {
    return null;
  }

  const numero = Number(dado[campo]);

  return Number.isFinite(numero) ? numero : null;
}


function ehRegistroDeLeitura(valor) {

  if (
    !valor ||
    typeof valor !== "object" ||
    Array.isArray(valor)
  ) {
    return false;
  }

  const campos = [
    "temperatura",
    "rpm",
    "corrente",
    "vibracao_pico_z",
    "acel_z"
  ];

  return campos.some(campo => valor[campo] !== undefined);
}


// Converte timestamp Unix para milissegundos.

function converterTimestamp(timestamp) {

  if (
    timestamp === undefined ||
    timestamp === null
  ) {
    return null;
  }

  const numero = Number(timestamp);

  if (!Number.isFinite(numero)) {
    return null;
  }

  // Unix em milissegundos
  if (numero >= 1000000000000) {
    return numero;
  }

  // Unix em segundos
  if (numero >= 1000000000) {
    return numero * 1000;
  }

  return null;
}


function formatarHora(timestamp) {

  const milissegundos = converterTimestamp(timestamp);

  if (milissegundos === null) {
    return "--:--:--";
  }

  return new Date(milissegundos).toLocaleTimeString("pt-BR");
}


// ==============================================================================
// MONITOR DE CONEXAO FIREBASE
// ==============================================================================

function monitorarStatusConexao() {

  const connectedRef = database.ref(".info/connected");

  connectedRef.on("value", (snapshot) => {

    const conectado = snapshot.val() === true;

    const statusEl = document.getElementById("status-text");
    const badgeEl = document.getElementById("status-badge");

    if (!statusEl || !badgeEl) return;

    if (conectado) {

      statusEl.textContent = "Firebase Online";
      badgeEl.className = "badge online";

    } else {

      statusEl.textContent = "Firebase Desconectado";
      badgeEl.className = "badge offline";
    }

  }, (erro) => {

    console.error("Erro ao monitorar Firebase:", erro);
  });
}


// ==============================================================================
// GRAFICO
// ==============================================================================

const canvas = document.getElementById("graficoLeituras");

let grafico = null;

if (canvas && typeof Chart !== "undefined") {

  grafico = new Chart(canvas.getContext("2d"), {

    type: "line",

    data: {

      labels: [],

      datasets: [

        {
          label: "Temperatura (°C)",
          data: [],
          borderColor: "#0099ff",
          backgroundColor: "#0099ff",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "Rotação (RPM)",
          data: [],
          borderColor: "#00e676",
          backgroundColor: "#00e676",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "Corrente (A)",
          data: [],
          borderColor: "#ffb300",
          backgroundColor: "#ffb300",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "Vibração (m/s²)",
          data: [],
          borderColor: "#ff3333",
          backgroundColor: "#ff3333",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          spanGaps: false
        }

      ]

    },

    options: {

      responsive: true,
      maintainAspectRatio: false,

      interaction: {
        intersect: false,
        mode: "index"
      },

      scales: {

        x: {
          grid: {
            color: "#1a1a1a"
          },

          ticks: {
            color: "#888888",
            font: {
              family: "Fira Code",
              size: 10
            }
          }
        },

        y: {
          grid: {
            color: "#1a1a1a"
          },

          ticks: {
            color: "#888888",
            font: {
              family: "Fira Code",
              size: 10
            }
          }
        }

      },

      plugins: {

        legend: {
          position: "bottom",

          labels: {
            color: "#cccccc",

            font: {
              family: "Plus Jakarta Sans",
              size: 11
            }
          }
        }

      }

    }

  });

} else {

  console.error("Chart.js ou canvas nao encontrado.");
}


// ==============================================================================
// ATUALIZACAO DO GRAFICO
// ==============================================================================

function atualizarGrafico(leituras) {

  if (!grafico) return;

  const labels = leituras.map(item => formatarHora(item.timestamp));

  const temperaturas = leituras.map(item =>
    obterNumero(item, "temperatura")
  );

  const rotacoes = leituras.map(item =>
    obterNumero(item, "rpm")
  );

  const correntes = leituras.map(item =>
    obterNumero(item, "corrente")
  );

  const vibracoes = leituras.map(item =>
    obterNumero(item, "vibracao_pico_z") ??
    obterNumero(item, "acel_z")
  );

  grafico.data.labels = labels;

  grafico.data.datasets[0].data = temperaturas;
  grafico.data.datasets[1].data = rotacoes;
  grafico.data.datasets[2].data = correntes;
  grafico.data.datasets[3].data = vibracoes;

  grafico.update();
}


// ==============================================================================
// ATUALIZACAO DOS CARDS
// ==============================================================================

function atualizarCards(dado) {

  const temperatura = obterNumero(dado, "temperatura");
  const rpm = obterNumero(dado, "rpm");
  const corrente = obterNumero(dado, "corrente");

  const vibracao =
    obterNumero(dado, "vibracao_pico_z") ??
    obterNumero(dado, "acel_z");

  const hora = formatarHora(dado.timestamp);

  document.getElementById("val-temp").textContent =
    temperatura !== null ? temperatura.toFixed(1) : "--";

  document.getElementById("val-rpm").textContent =
    rpm !== null ? rpm.toLocaleString("pt-BR") : "--";

  document.getElementById("val-corrente").textContent =
    corrente !== null ? corrente.toFixed(2) : "--";

  document.getElementById("val-acel").textContent =
    vibracao !== null ? vibracao.toFixed(2) : "--";

  document.getElementById("time-temp").textContent = hora;
  document.getElementById("time-rpm").textContent = hora;
  document.getElementById("time-corrente").textContent = hora;
  document.getElementById("time-acel").textContent = hora;
}


function limparCards() {

  const campos = [
    "val-temp",
    "val-rpm",
    "val-corrente",
    "val-acel"
  ];

  campos.forEach(id => {
    document.getElementById(id).textContent = "--";
  });

  const horarios = [
    "time-temp",
    "time-rpm",
    "time-corrente",
    "time-acel"
  ];

  horarios.forEach(id => {
    document.getElementById(id).textContent = "--:--:--";
  });
}


// ==============================================================================
// CLASSIFICACAO DO ESTADO DO MOTOR
// ==============================================================================

function classificarEstadoMotor(dado) {

  const rpm = obterNumero(dado, "rpm");
  const corrente = obterNumero(dado, "corrente");

  // Sem informacoes suficientes para determinar o estado.
  if (rpm === null && corrente === null) {
    return "unknown";
  }

  // Ambos os indicadores precisam confirmar a ausencia de operacao.
  if (
    rpm !== null &&
    corrente !== null &&
    rpm <= 0 &&
    corrente <= 0
  ) {
    return "off";
  }

  // Rotacao ou corrente positiva indica atividade.
  if (
    (rpm !== null && rpm > 0) ||
    (corrente !== null && corrente > 0)
  ) {
    return "running";
  }

  return "unknown";
}


// ==============================================================================
// MOTOR DE DIAGNOSTICO
// ==============================================================================

function analisarSaudeDoMotor(dado) {

  const diagnosticos = [];

  let nivelMaximo = "ok";

  const temperatura = obterNumero(dado, "temperatura");
  const corrente = obterNumero(dado, "corrente");

  const vibracao =
    obterNumero(dado, "vibracao_pico_z") ??
    obterNumero(dado, "acel_z");

  const rpm = obterNumero(dado, "rpm");

  function adicionarDiagnostico(nivel, titulo, causa, acao) {

    diagnosticos.push({
      nivel,
      titulo,
      causa,
      acao
    });

    if (nivel === "danger") {
      nivelMaximo = "danger";
    } else if (
      nivel === "warning" &&
      nivelMaximo !== "danger"
    ) {
      nivelMaximo = "warning";
    }
  }


  // TEMPERATURA

  if (temperatura !== null) {

    if (temperatura > LIMITES.temperaturaCritica) {

      adicionarDiagnostico(
        "danger",
        "ALERTA: SOBREAQUECIMENTO CRÍTICO",
        "Temperatura acima de 90°C. Existe risco de degradação do isolamento térmico do motor.",
        "Verificar ventilação, obstruções físicas e condição térmica do equipamento."
      );

    } else if (temperatura > LIMITES.temperaturaAtencao) {

      adicionarDiagnostico(
        "warning",
        "ATENÇÃO: TEMPERATURA ELEVADA",
        "Temperatura acima de 75°C. Pode existir acúmulo térmico acima do esperado.",
        "Inspecionar fluxo de ar, ventilação e sujeira acumulada nas aletas."
      );

    }

  }


  // CORRENTE ELETRICA

  if (corrente !== null) {

    if (corrente > LIMITES.correnteCritica) {

      adicionarDiagnostico(
        "danger",
        "ALERTA: SOBRECORRENTE ELÉTRICA",
        "Corrente acima de 15 A. Pode indicar sobrecarga ou condição anormal de operação.",
        "Verificar carga mecânica, alimentação elétrica e corrente nominal do motor."
      );

    } else if (corrente > LIMITES.correnteAtencao) {

      adicionarDiagnostico(
        "warning",
        "ATENÇÃO: CONSUMO ELEVADO",
        "Corrente acima de 10 A. Pode indicar aumento da solicitação elétrica ou mecânica.",
        "Verificar carga, rolamentos, acoplamento e condições de alimentação."
      );

    }

  }


  // VIBRACAO

  if (vibracao !== null) {

    if (vibracao > LIMITES.vibracaoCritica) {

      adicionarDiagnostico(
        "danger",
        "ALERTA: VIBRAÇÃO CRÍTICA",
        "A aceleração de vibração ultrapassou o limite crítico configurado para este protótipo.",
        "Inspecionar fixação, rolamentos e alinhamento do conjunto mecânico."
      );

    } else if (vibracao > LIMITES.vibracaoAtencao) {

      adicionarDiagnostico(
        "warning",
        "ATENÇÃO: ELEVAÇÃO DE VIBRAÇÃO",
        "A aceleração de vibração ultrapassou o limite de atenção configurado.",
        "Verificar fixação da base e acompanhar a evolução das medições."
      );

    }

  }


  // VERIFICACAO DE TELEMETRIA COMPLETA

  const camposAusentes = [];

  if (temperatura === null) camposAusentes.push("temperatura");
  if (rpm === null) camposAusentes.push("RPM");
  if (corrente === null) camposAusentes.push("corrente");
  if (vibracao === null) camposAusentes.push("vibração");

  if (camposAusentes.length > 0) {

    adicionarDiagnostico(
      "warning",
      "TELEMETRIA INCOMPLETA",
      "Não foram recebidos todos os parâmetros esperados: " +
      camposAusentes.join(", ") + ".",
      "Verificar os sensores, a comunicação e a estrutura dos dados enviados pelo ESP32."
    );

  }


  // NENHUM ALERTA

  if (diagnosticos.length === 0) {

    adicionarDiagnostico(
      "ok",
      "SISTEMA OPERANDO DENTRO DOS LIMITES",
      "Todos os parâmetros recebidos estão dentro dos limites configurados.",
      "Continuar monitoramento e manter o cronograma de manutenção preventiva."
    );

  }

  return {
    diagnosticos,
    nivelMaximo
  };
}


// ==============================================================================
// ATUALIZACAO DO PAINEL DE DIAGNOSTICO
// ==============================================================================

function atualizarPainelDiagnostico(lista, nivelMax, textoSaude) {

  const container = document.getElementById("diagnostic-container");
  const badgeHealth = document.getElementById("health-badge");
  const textHealth = document.getElementById("health-text");
  const countText = document.getElementById("diagnostic-count");

  const classes = {
    ok: "health-ok",
    warning: "health-warning",
    danger: "health-danger",
    unknown: "health-unknown"
  };

  badgeHealth.className = "badge " + (classes[nivelMax] || classes.unknown);

  textHealth.textContent = textoSaude;

  countText.textContent =
    `${lista.length} ${lista.length === 1 ? "análise" : "análises"}`;

  container.innerHTML = lista.map(item => `

    <div class="diag-card ${item.nivel}">

      <div class="diag-title">
        ${item.titulo}
      </div>

      <div class="diag-desc">
        <strong>Diagnóstico:</strong> ${item.causa}
      </div>

      <div class="diag-action">
        <strong>Ação Recomendada:</strong> ${item.acao}
      </div>

    </div>

  `).join("");
}


// ==============================================================================
// MOTOR DESLIGADO OU SEM SINAL
// ==============================================================================

function tratarMotorDesligado(mensagem) {

  const badgeHealth = document.getElementById("health-badge");
  const textHealth = document.getElementById("health-text");

  const countText = document.getElementById("diagnostic-count");
  const container = document.getElementById("diagnostic-container");

  badgeHealth.className = "badge health-unknown";
  textHealth.textContent = mensagem;

  countText.textContent = "Sem alertas operacionais";

  container.innerHTML = `

    <div class="diag-card">

      <div class="diag-title">
        ${mensagem.toUpperCase()}
      </div>

      <div class="diag-desc">
        A leitura de rotação e corrente indica que o motor está desligado.
      </div>

      <div class="diag-action">
        Os alertas de condição serão atualizados quando o motor voltar a operar.
      </div>

    </div>

  `;
}


function tratarSemSinal(mensagem) {

  if (estadoSinalAtual === mensagem) return;

  estadoSinalAtual = mensagem;

  const badgeHealth = document.getElementById("health-badge");
  const textHealth = document.getElementById("health-text");

  const countText = document.getElementById("diagnostic-count");
  const container = document.getElementById("diagnostic-container");

  badgeHealth.className = "badge health-unknown";
  textHealth.textContent = mensagem;

  countText.textContent = "Sem medições recentes";

  container.innerHTML = `

    <div class="diag-card">

      <div class="diag-title">
        ${mensagem.toUpperCase()}
      </div>

      <div class="diag-desc">
        Não existem leituras recentes disponíveis para análise operacional.
      </div>

      <div class="diag-action">
        Verificar conexão Wi-Fi, ESP32 e transmissão de dados ao Firebase.
      </div>

    </div>

  `;
}


// ==============================================================================
// PROCESSAMENTO DA LEITURA MAIS RECENTE
// ==============================================================================

function processarLeituraMaisRecente(dado) {

  atualizarCards(dado);

  const estadoMotor = classificarEstadoMotor(dado);

  const resultado = analisarSaudeDoMotor(dado);

  const lista = resultado.diagnosticos;
  const nivel = resultado.nivelMaximo;

  // Motor desligado confirmado por RPM e corrente.
  if (estadoMotor === "off") {

    if (
      nivel === "ok"
    ) {

      tratarMotorDesligado("Motor desligado");

    } else {

      atualizarPainelDiagnostico(
        lista,
        nivel,
        "Alertas identificados com motor parado"
      );

    }

    return;
  }


  // Motor em operação.
  if (estadoMotor === "running") {

    let textoSaude;

    if (nivel === "danger") {

      textoSaude = "Risco operacional";

    } else if (nivel === "warning") {

      textoSaude = "Atenção: verificar parâmetros";

    } else {

      textoSaude = "Motor operacional";

    }

    atualizarPainelDiagnostico(
      lista,
      nivel,
      textoSaude
    );

    return;
  }


  // Não foi possível determinar o estado.
  atualizarPainelDiagnostico(
    lista,
    nivel,
    "Dados insuficientes para confirmar operação"
  );
}


// ==============================================================================
// ORGANIZACAO DAS LEITURAS DO FIREBASE
// ==============================================================================

function obterLeituras(snapshot) {

  const dados = snapshot.val();

  if (!dados) {
    return [];
  }

  const registros = [];

  // Primeiro tenta identificar os registros individuais,
  // criados pelo Database.push() no ESP32.

  snapshot.forEach((childSnapshot) => {

    const item = childSnapshot.val();

    if (ehRegistroDeLeitura(item)) {

      registros.push({
        ...item,
        _key: childSnapshot.key
      });

    }

  });


  if (registros.length > 0) {

    registros.sort((a, b) => {

      const tempoA = converterTimestamp(a.timestamp);
      const tempoB = converterTimestamp(b.timestamp);

      if (tempoA !== null && tempoB !== null) {
        return tempoA - tempoB;
      }

      return String(a._key).localeCompare(String(b._key));
    });

    return registros.slice(-QUANTIDADE_AMOSTRAS);
  }


  // Compatibilidade com o formato antigo:
  // um único objeto diretamente em /leituras.

  if (ehRegistroDeLeitura(dados)) {

    return [{
      ...dados,
      _key: "leitura-atual"
    }];

  }

  return [];
}


// ==============================================================================
// ESCUTA EM TEMPO REAL
// ==============================================================================

function escutarLeiturasEmTempoReal() {

  const leiturasRef = database
    .ref("leituras")
    .orderByKey()
    .limitToLast(QUANTIDADE_AMOSTRAS);


  leiturasRef.on("value", (snapshot) => {

    const leituras = obterLeituras(snapshot);


    // Nenhum dado recebido.
    if (leituras.length === 0) {

      ultimoTempoRecebimento = null;

      limparCards();

      if (grafico) {

        grafico.data.labels = [];

        grafico.data.datasets.forEach(dataset => {
          dataset.data = [];
        });

        grafico.update();
      }

      tratarSemSinal("Aguardando dados do ESP32");

      return;
    }


    // Recebimento confirmado.
    ultimoTempoRecebimento = Date.now();

    estadoSinalAtual = "";


    // Atualiza gráfico com as últimas 20 amostras.
    atualizarGrafico(leituras);


    // Processa a amostra mais recente.
    const ultimoDado = leituras[leituras.length - 1];

    console.log("Leituras recebidas:", leituras);
    console.log("Última leitura:", ultimoDado);

    processarLeituraMaisRecente(ultimoDado);

  }, (erro) => {

    console.error("Erro ao buscar leituras:", erro);

    tratarSemSinal("Erro ao receber dados do Firebase");

  });

}


// ==============================================================================
// MONITORAMENTO DO TEMPO SEM RECEBIMENTO
// ==============================================================================

setInterval(() => {

  const agora = Date.now();

  // Ainda não recebemos nenhuma leitura.
  if (ultimoTempoRecebimento === null) {

    if (agora - inicioMonitoramento > TIMEOUT_LIMITE_MS) {

      tratarSemSinal("Aguardando telemetria do ESP32");
    }

    return;
  }


  // Já recebemos dados, mas a transmissão parou.
  const tempoSemDados = agora - ultimoTempoRecebimento;

  if (tempoSemDados > TIMEOUT_LIMITE_MS) {

    tratarSemSinal("Sinal de telemetria interrompido");
  }

}, 2000);


// ==============================================================================
// INICIALIZACAO
// ==============================================================================

monitorarStatusConexao();

escutarLeiturasEmTempoReal();

console.log("MoniMotor inicializado com sucesso.");
