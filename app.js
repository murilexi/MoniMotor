
// ==============================================================================
// MONIMOTOR
// Monitoramento de motores industriais
// Firebase Realtime Database + Chart.js
// ==============================================================================

// MANTENHA AQUI SEU firebaseConfig ORIGINAL.

const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "upx2---projeto.firebaseapp.com",
  databaseURL: "https://upx2---projeto-default-rtdb.firebaseio.com/",
  projectId: "upx2---projeto",
  storageBucket: "upx2---projeto.firebasestorage.app",
  messagingSenderId: "320149787397",
  appId: "SEU_APP_ID"
};

// ==============================================================================
// FIREBASE
// ==============================================================================

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();

const leiturasRef = database
  .ref("leituras")
  .orderByKey()
  .limitToLast(20);


// ==============================================================================
// CONFIGURACOES DO MONITORAMENTO
// ==============================================================================

const CONFIG = {

  intervaloTimeout: 15000,

  quantidadeAmostras: 20,

  amostrasReferencia: 10,

  amostrasPersistencia: 3,

  // Valores para diferenciar motor parado de motor em operação.
  // Ajustar conforme a corrente real e a rotação do motor.

  rpmMinimoOperacao: 30,

  correnteMinimaOperacao: 0.25,

  // Detectores relativos à referência operacional.

  aumentoTemperatura: 4.0,

  aumentoCorrentePercentual: 0.25,

  aumentoCorrenteAbsoluto: 0.30,

  aumentoVibracaoPercentual: 0.50,

  aumentoVibracaoAbsoluto: 0.30,

  quedaRPMPercentual: 0.12,

  // Oscilações persistentes.

  variacaoRPM: 0.08,

  variacaoCorrente: 0.20

};

let ultimoRecebimento = null;

let alertaTimeoutExibido = false;

let referenciaOperacional = null;

let grafico = null;

let sessaoTesteAtual = null;

// ==============================================================================
// FUNCOES DE CONVERSAO E VALIDACAO
// ==============================================================================

function numeroValido(valor) {

  if (
    valor === undefined ||
    valor === null ||
    valor === ""
  ) {
    return null;
  }

  const numero = Number(valor);

  return Number.isFinite(numero) ? numero : null;

}


function obterTemperatura(dado) {

  if (dado.sensor_ds18b20_ok === false) {
    return null;
  }

  const valor = numeroValido(dado.temperatura);

  if (valor === null || valor < -55 || valor > 125) {
    return null;
  }

  return valor;

}


function obterRPM(dado) {

  const valor = numeroValido(dado.rpm);

  if (
    valor === null ||
    valor < 0 ||
    valor > 50000
  ) {
    return null;
  }

  return valor;

}


function obterCorrente(dado) {

  if (dado.sensor_acs712_ok === false) {
    return null;
  }

  const valor = numeroValido(dado.corrente);

  if (
    valor === null ||
    valor < 0 ||
    valor > 100
  ) {
    return null;
  }

  return valor;

}


// IMPORTANTE:
// O dashboard utiliza vibracao_rms_z.
// Nao confundir esse campo com vibracao_pico_z.

function obterVibracao(dado) {

  if (dado.sensor_mpu6050_ok === false) {
    return null;
  }

  const valor = numeroValido(dado.vibracao_rms_z);

  if (
    valor === null ||
    valor < 0 ||
    valor > 100
  ) {
    return null;
  }

  return valor;

}


function converterTimestamp(valor) {

  const numero = numeroValido(valor);

  if (numero === null) return null;

  if (numero >= 1000000000000) {
    return numero;
  }

  if (numero >= 1000000000) {
    return numero * 1000;
  }

  return null;

}


function formatarHora(timestamp) {

  const tempo = converterTimestamp(timestamp);

  if (tempo === null) {
    return "--:--:--";
  }

  return new Date(tempo).toLocaleTimeString("pt-BR");

}


function registroValido(dado) {

  if (
    !dado ||
    typeof dado !== "object" ||
    Array.isArray(dado)
  ) {
    return false;
  }

  return (
    Object.prototype.hasOwnProperty.call(dado, "temperatura") ||
    Object.prototype.hasOwnProperty.call(dado, "rpm") ||
    Object.prototype.hasOwnProperty.call(dado, "corrente") ||
    Object.prototype.hasOwnProperty.call(dado, "vibracao_rms_z")
  );

}


function leituraCompleta(dado) {

  return (
    obterTemperatura(dado) !== null &&
    obterRPM(dado) !== null &&
    obterCorrente(dado) !== null &&
    obterVibracao(dado) !== null
  );

}


// ==============================================================================
// ESTATISTICA
// ==============================================================================

function mediana(valores) {

  const ordenados = valores
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (ordenados.length === 0) return null;

  const meio = Math.floor(ordenados.length / 2);

  if (ordenados.length % 2 === 0) {
    return (ordenados[meio - 1] + ordenados[meio]) / 2;
  }

  return ordenados[meio];

}


function coeficienteVariacao(valores) {

  const validos = valores.filter(Number.isFinite);

  if (validos.length < 3) return 0;

  const media = validos.reduce((a, b) => a + b, 0) / validos.length;

  if (media <= 0) return 0;

  const variancia = validos.reduce(
    (soma, valor) => soma + Math.pow(valor - media, 2),
    0
  ) / validos.length;

  return Math.sqrt(variancia) / media;

}


function persistenciaConfirmada(leituras, seletor, condicao) {

  if (leituras.length < CONFIG.amostrasPersistencia) {
    return false;
  }

  const recentes = leituras.slice(
    -CONFIG.amostrasPersistencia
  );

  return recentes.every(dado => {

    const valor = seletor(dado);

    return valor !== null && condicao(valor);

  });

}


// ==============================================================================
// LEITURAS DO FIREBASE
// ==============================================================================

function obterLeituras(snapshot) {

  const dados = snapshot.val();

  if (!dados) return [];

  // Compatibilidade com o antigo formato de leitura unica.

  if (registroValido(dados)) {

    return [{
      ...dados,
      _key: "registro-antigo"
    }];

  }

  const registros = [];

  // Novo formato: registros criados por PUSH.

  snapshot.forEach(childSnapshot => {

    const item = childSnapshot.val();

    if (registroValido(item)) {

      registros.push({
        ...item,
        _key: childSnapshot.key
      });

    }

  });

  registros.sort((a, b) => {

    const tempoA = converterTimestamp(a.timestamp);
    const tempoB = converterTimestamp(b.timestamp);

    if (tempoA !== null && tempoB !== null) {
      return tempoA - tempoB;
    }

    return String(a._key).localeCompare(String(b._key));

  });

  return registros.slice(-CONFIG.quantidadeAmostras);

}


// ==============================================================================
// MONITOR DE CONEXAO FIREBASE
// ==============================================================================

function monitorarStatusConexao() {

  database.ref(".info/connected").on("value", snapshot => {

    const online = snapshot.val() === true;

    const status = document.getElementById("status-text");
    const badge = document.getElementById("status-badge");

    if (!status || !badge) return;

    status.textContent = online
      ? "Firebase Online"
      : "Desconectado";

    badge.className = online
      ? "badge online"
      : "badge offline";

  }, erro => {

    console.error("Erro de conexão Firebase:", erro);

  });

}


// ==============================================================================
// GRAFICO
// ==============================================================================

const canvas = document.getElementById("graficoLeituras");

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
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "RPM",
          data: [],
          borderColor: "#00e676",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "Corrente RMS (A)",
          data: [],
          borderColor: "#ffb300",
          borderWidth: 2,
          pointRadius: 2,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "Aceleração RMS Z (m/s²)",
          data: [],
          borderColor: "#ff3333",
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

  console.error("Chart.js ou canvas não encontrado.");

}


// ==============================================================================
// ATUALIZACAO DOS INDICADORES
// ==============================================================================

function atualizarCards(dado) {

  const temperatura = obterTemperatura(dado);
  const rpm = obterRPM(dado);
  const corrente = obterCorrente(dado);
  const vibracao = obterVibracao(dado);

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

  [
    "val-temp",
    "val-rpm",
    "val-corrente",
    "val-acel"
  ].forEach(id => {

    document.getElementById(id).textContent = "--";

  });

  [
    "time-temp",
    "time-rpm",
    "time-corrente",
    "time-acel"
  ].forEach(id => {

    document.getElementById(id).textContent = "--:--:--";

  });

}


// ==============================================================================
// ATUALIZACAO DO GRAFICO
// ==============================================================================

function atualizarGrafico(leituras) {

  if (!grafico) return;

  grafico.data.labels = leituras.map(
    dado => formatarHora(dado.timestamp)
  );

  grafico.data.datasets[0].data = leituras.map(
    obterTemperatura
  );

  grafico.data.datasets[1].data = leituras.map(
    obterRPM
  );

  grafico.data.datasets[2].data = leituras.map(
    obterCorrente
  );

  grafico.data.datasets[3].data = leituras.map(
    obterVibracao
  );

  grafico.update();

}


// ==============================================================================
// ESTADO DO MOTOR
// ==============================================================================

function identificarEstadoMotor(dado) {

  const rpm = obterRPM(dado);
  const corrente = obterCorrente(dado);

  if (rpm === null || corrente === null) {
    return "indeterminado";
  }

  const temRotacao = rpm > CONFIG.rpmMinimoOperacao;

  const temCorrente = corrente > CONFIG.correnteMinimaOperacao;

  if (!temRotacao && !temCorrente) {
    return "parado";
  }

  if (temRotacao && temCorrente) {
    return "operando";
  }

  if (!temRotacao && temCorrente) {
    return "corrente_sem_rotacao";
  }

  return "inconsistente";

}


// ==============================================================================
// REFERENCIA OPERACIONAL
// ==============================================================================


function capturarReferencia(leituras) {

  if (referenciaOperacional !== null) {
    atualizarEstadoReferencia(true, CONFIG.amostrasReferencia);
    return referenciaOperacional;
  }

  if (leituras.length === 0) return null;

  const modoAtual = leituras[leituras.length - 1].modo;

  let amostrasValidas = leituras.filter(dado => {

    return (
      dado.modo === modoAtual &&
      leituraCompleta(dado) &&
      identificarEstadoMotor(dado) === "operando"
    );

  });

  // Nos testes, só usamos amostras da sessão atual.
  if (modoAtual === "simulacao" && sessaoTesteAtual) {

    amostrasValidas = amostrasValidas.filter(
      dado => dado.sessao_teste === sessaoTesteAtual
    );

  }

  if (amostrasValidas.length < CONFIG.amostrasReferencia) {

    atualizarEstadoReferencia(
      false,
      amostrasValidas.length
    );

    return null;
  }

  const base = amostrasValidas.slice(
    0,
    CONFIG.amostrasReferencia
  );

  referenciaOperacional = {

    temperatura: mediana(base.map(obterTemperatura)),

    rpm: mediana(base.map(obterRPM)),

    corrente: mediana(base.map(obterCorrente)),

    vibracao: mediana(base.map(obterVibracao))

  };

  console.log(
    "REFERÊNCIA OPERACIONAL:",
    referenciaOperacional
  );

  atualizarEstadoReferencia(true, CONFIG.amostrasReferencia);

  return referenciaOperacional;

}


// ==============================================================================
// PAINEL DE DIAGNOSTICO
// ==============================================================================

function atualizarPainelDiagnostico(lista, nivel, textoSaude) {

  const container = document.getElementById("diagnostic-container");

  const badge = document.getElementById("health-badge");

  const texto = document.getElementById("health-text");

  const contador = document.getElementById("diagnostic-count");

  const classes = {

    ok: "health-ok",

    warning: "health-warning",

    danger: "health-danger",

    unknown: "health-unknown"

  };

  badge.className =
    "badge " + (classes[nivel] || classes.unknown);

  texto.textContent = textoSaude;

  contador.textContent =
    `${lista.length} ${lista.length === 1 ? "análise" : "análises"}`;

  container.innerHTML = lista.map(item => `

    <div class="diag-card ${item.nivel}">

      <div class="diag-title">
        ${item.titulo}
      </div>

      <div class="diag-desc">
        <strong>Sensores:</strong> ${item.sensores}
      </div>

      <div class="diag-desc">
        <strong>Resultado:</strong> ${item.causa}
      </div>

      <div class="diag-action">
        <strong>Recomendação:</strong> ${item.acao}
      </div>

    </div>

  `).join("");

}


// ==============================================================================
// ANALISE DE MANUTENCAO
// ==============================================================================

function analisarSaudeDoMotor(leituras) {

  const diagnosticos = [];

  let nivelMaximo = "ok";

  const atual = leituras[leituras.length - 1];

  function adicionar(nivel, titulo, sensores, causa, acao) {

    diagnosticos.push({

      nivel,
      titulo,
      sensores,
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


  // --------------------------------------------------------------------------
  // VERIFICACAO DOS SENSORES
  // --------------------------------------------------------------------------

  if (atual.sensor_ds18b20_ok === false) {

    adicionar(
      "warning",
      "FALHA DE LEITURA DE TEMPERATURA",
      "DS18B20",
      "O ESP32 não conseguiu obter uma leitura válida do sensor.",
      "Verificar alimentação, conexão de dados, resistor de pull-up e integridade do DS18B20."
    );

  }

  if (atual.sensor_mpu6050_ok === false) {

    adicionar(
      "warning",
      "FALHA DE COMUNICAÇÃO COM O MPU6050",
      "MPU6050",
      "A aquisição de aceleração não está disponível.",
      "Verificar alimentação, endereço I2C, conexões SDA/SCL e fixação da placa."
    );

  }

  if (atual.sensor_acs712_ok === false) {

    adicionar(
      "warning",
      "LEITURA ANALÓGICA DO ACS712 INVÁLIDA",
      "ACS712",
      "A leitura do canal analógico não está dentro da faixa esperada.",
      "Verificar alimentação, divisor de tensão, GND comum e ligação da saída analógica."
    );

  }


  // --------------------------------------------------------------------------
  // REFERENCIA OPERACIONAL
  // --------------------------------------------------------------------------

  const referencia = capturarReferencia(leituras);

  if (referencia === null) {

    const quantidade = leituras.filter(dado => {

      return (
        dado.modo !== "simulacao" &&
        leituraCompleta(dado) &&
        identificarEstadoMotor(dado) === "operando"
      );

    }).length;

    adicionar(
      "ok",
      "COLETANDO REFERÊNCIA OPERACIONAL",
      "DS18B20 + Hall + ACS712 + MPU6050",
      `Foram obtidas ${quantidade} de ${CONFIG.amostrasReferencia} amostras completas em operação.`,
      "Manter o motor em condição normal e estável para formar a referência. Não interpretar esta etapa como diagnóstico de saúde."
    );

    return {
      diagnosticos,
      nivelMaximo,
      referencia: null
    };

  }


  // --------------------------------------------------------------------------
  // DETECCAO DE ANOMALIAS PERSISTENTES
  // --------------------------------------------------------------------------

  const temperaturaAlta = persistenciaConfirmada(

    leituras,
    obterTemperatura,

    valor => valor >=
      referencia.temperatura + CONFIG.aumentoTemperatura

  );


  const correnteAlta = persistenciaConfirmada(

    leituras,
    obterCorrente,

    valor => {

      const limitePercentual =
        referencia.corrente *
        (1 + CONFIG.aumentoCorrentePercentual);

      const limiteAbsoluto =
        referencia.corrente +
        CONFIG.aumentoCorrenteAbsoluto;

      return valor >= Math.max(
        limitePercentual,
        limiteAbsoluto
      );

    }

  );


  const rpmBaixo = persistenciaConfirmada(

    leituras,
    obterRPM,

    valor => valor <=
      referencia.rpm *
      (1 - CONFIG.quedaRPMPercentual)

  );


  const vibracaoAlta = persistenciaConfirmada(

    leituras,
    obterVibracao,

    valor => {

      const limitePercentual =
        referencia.vibracao *
        (1 + CONFIG.aumentoVibracaoPercentual);

      const limiteAbsoluto =
        referencia.vibracao +
        CONFIG.aumentoVibracaoAbsoluto;

      return valor >= Math.max(
        limitePercentual,
        limiteAbsoluto
      );

    }

  );


  // --------------------------------------------------------------------------
  // CORRENTE + RPM
  // --------------------------------------------------------------------------

  if (correnteAlta && rpmBaixo) {

    adicionar(
      "warning",
      "AUMENTO DE CARGA COM REDUÇÃO DE ROTAÇÃO",
      "ACS712 + Hall",

      "A corrente RMS aumentou enquanto a rotação caiu de forma persistente. O comportamento pode estar associado a aumento da carga acionada, atrito mecânico, problema no acionamento ou erro de medição.",

      "Conferir corrente nominal, alimentação elétrica, carga, acoplamento, rolamentos e rotação com instrumentos independentes. Verificar também se o sensor Hall está contando todos os pulsos."
    );

  } else {

    if (correnteAlta) {

      adicionar(
        "warning",
        "AUMENTO PERSISTENTE DE CORRENTE",
        "ACS712",

        "A corrente RMS ficou acima da referência operacional. Pode indicar aumento da carga, alteração de alimentação ou mudança nas condições de acionamento.",

        "Comparar com a corrente nominal da placa do motor e com um alicate amperímetro. Investigar carga mecânica, conexões, tensão e condições do acionamento."
      );

    }

    if (rpmBaixo) {

      adicionar(
        "warning",
        "REDUÇÃO PERSISTENTE DE ROTAÇÃO",
        "Sensor Hall",

        "A rotação ficou abaixo da referência. A causa pode estar na carga, no acionamento, na transmissão mecânica ou na aquisição dos pulsos.",

        "Verificar ímã, distância do sensor Hall, pulsos por volta, rotação com tacômetro independente e condições da carga."
      );

    }

  }


  // --------------------------------------------------------------------------
  // TEMPERATURA
  // --------------------------------------------------------------------------

  if (temperaturaAlta) {

    adicionar(
      "warning",
      "ELEVAÇÃO PERSISTENTE DE TEMPERATURA",
      "DS18B20",

      "A temperatura subiu pelo menos 4 °C em relação à referência operacional e permaneceu elevada nas três últimas amostras.",

      "Inspecionar ventilação, aletas, fluxo de ar, carga mecânica e contato físico do sensor. Comparar a leitura com o limite térmico especificado pelo fabricante."
    );

  }


  // --------------------------------------------------------------------------
  // TEMPERATURA + CORRENTE
  // --------------------------------------------------------------------------

  if (temperaturaAlta && correnteAlta) {

    adicionar(
      "warning",
      "AQUECIMENTO ASSOCIADO AO AUMENTO DE CORRENTE",
      "DS18B20 + ACS712",

      "O aumento de temperatura acompanha o crescimento da corrente RMS. A combinação pode indicar aumento de solicitação do motor ou dissipação térmica insuficiente.",

      "Verificar carga, ventilação, conexões elétricas e rolamentos. Confirmar as leituras antes de concluir que existe sobrecarga."
    );

  }


  // --------------------------------------------------------------------------
  // VIBRACAO
  // --------------------------------------------------------------------------

  if (vibracaoAlta) {

    adicionar(
      "warning",
      "AUMENTO PERSISTENTE DA ACELERAÇÃO",
      "MPU6050",

      "A aceleração RMS dinâmica no eixo Z ultrapassou a referência em mais de 50%, com acréscimo mínimo de 0,30 m/s².",

      "Conferir fixação do MPU6050, base, acoplamento e rolamentos. Complementar a medição com os três eixos e análise de frequência antes de atribuir a causa a um componente específico."
    );

  }


  // --------------------------------------------------------------------------
  // INSTABILIDADE DA ROTACAO
  // --------------------------------------------------------------------------

  if (leituras.length >= 5) {

    const ultimas = leituras.slice(-5);

    const rpms = ultimas
      .map(obterRPM)
      .filter(v => v !== null);

    const correntes = ultimas
      .map(obterCorrente)
      .filter(v => v !== null);

    const variacaoRPM = coeficienteVariacao(rpms);

    const variacaoCorrente = coeficienteVariacao(correntes);

    if (
      identificarEstadoMotor(atual) === "operando" &&
      variacaoRPM > CONFIG.variacaoRPM
    ) {

      adicionar(
        "warning",
        "OSCILAÇÃO DE ROTAÇÃO",
        "Sensor Hall",

        "A rotação apresentou variação relativa superior a 8% nas últimas cinco amostras.",

        "Investigar variação da carga, acionamento, alimentação e qualidade da contagem de pulsos do sensor Hall."
      );

    }

    if (
      identificarEstadoMotor(atual) === "operando" &&
      variacaoCorrente > CONFIG.variacaoCorrente
    ) {

      adicionar(
        "warning",
        "OSCILAÇÃO DE CORRENTE",
        "ACS712",

        "A corrente RMS apresentou variação relativa superior a 20% nas últimas cinco amostras.",

        "Verificar variação da carga, alimentação, conexões e estabilidade do acionamento. Confirmar a medição com instrumento independente."
      );

    }

  }


  // --------------------------------------------------------------------------
  // NENHUMA ANOMALIA
  // --------------------------------------------------------------------------

  if (diagnosticos.length === 0) {

    adicionar(
      "ok",
      "SEM DESVIOS PERSISTENTES IDENTIFICADOS",
      "DS18B20 + Hall + ACS712 + MPU6050",

      "Os parâmetros recebidos não apresentaram os desvios configurados em relação à referência operacional.",

      "Manter o acompanhamento das leituras e registrar as condições normais de operação. A ausência de desvios não comprova ausência de falhas."
    );

  }


  return {
    diagnosticos,
    nivelMaximo,
    referencia
  };

}


// ==============================================================================
// ATUALIZACAO DO PAINEL
// ==============================================================================

function tratarEstadoSemSinal(mensagem) {

  document.getElementById("health-badge").className =
    "badge health-unknown";

  document.getElementById("health-text").textContent =
    mensagem;

  document.getElementById("diagnostic-count").textContent =
    "Sem medições recentes";

  document.getElementById("diagnostic-container").innerHTML = `

    <div class="diag-card">

      <div class="diag-title">
        ${mensagem.toUpperCase()}
      </div>

      <div class="diag-desc">
        Não há dados recentes suficientes para avaliar a condição do motor.
      </div>

      <div class="diag-action">
        Verificar ESP32, Wi-Fi, Firebase e disponibilidade dos sensores.
      </div>

    </div>

  `;

}


// ==============================================================================
// PROCESSAMENTO DE CADA ATUALIZACAO
// ==============================================================================

function processarLeituras(leituras) {

  if (leituras.length === 0) {

    limparCards();

    if (grafico) {

      grafico.data.labels = [];

      grafico.data.datasets.forEach(dataset => {
        dataset.data = [];
      });

      grafico.update();

    }

    tratarEstadoSemSinal("Aguardando leituras do ESP32");

    return;

  }

  const atual = leituras[leituras.length - 1];

  atualizarCards(atual);

  atualizarGrafico(leituras);

  // Não aceitar dados antigos de simulação como telemetria física.

  if (atual.modo === "simulacao") {

    tratarEstadoSemSinal(
      "O ESP32 ainda está enviando dados simulados"
    );

    return;

  }

  const resultado = analisarSaudeDoMotor(leituras);

  const estadoMotor = identificarEstadoMotor(atual);

  const lista = resultado.diagnosticos;

  let nivel = resultado.nivelMaximo;

  let textoSaude = "Monitoramento em análise";


  if (estadoMotor === "parado") {

    textoSaude = "Motor parado";

    if (nivel === "ok") {
      nivel = "unknown";
    }

  } else if (estadoMotor === "operando") {

    if (nivel === "danger") {
      textoSaude = "Prioridade alta";
    } else if (nivel === "warning") {
      textoSaude = "Desvio detectado";
    } else if (!resultado.referencia) {
      textoSaude = "Coletando referência";
    } else {
      textoSaude = "Motor em operação";
    }

  } else if (estadoMotor === "corrente_sem_rotacao") {

    textoSaude = "Corrente presente sem rotação";

    nivel = "warning";

    lista.unshift({

      nivel: "warning",

      titulo: "VERIFICAR POSSÍVEL BLOQUEIO OU FALHA DE ROTAÇÃO",

      sensores: "ACS712 + Hall",

      causa: "Existe corrente detectável, mas a rotação está abaixo do limite de operação configurado. Pode ser uma condição anormal do motor ou falha no sensor Hall.",

      acao: "Verificar a condição real do motor, o acionamento e a alimentação elétrica. Conferir o sensor Hall antes de concluir que existe bloqueio mecânico."

    });

  } else {

    textoSaude = "Leituras inconsistentes";

    if (nivel === "ok") nivel = "warning";

  }


  if (
    !leituraCompleta(atual) &&
    !lista.some(item => item.titulo === "TELEMETRIA INCOMPLETA")
  ) {

    lista.unshift({

      nivel: "warning",

      titulo: "TELEMETRIA INCOMPLETA",

      sensores: "Um ou mais canais",

      causa: "Não foi possível obter todos os valores necessários para uma avaliação integrada.",

      acao: "Conferir sensores, alimentação, fiação e comunicação."

    });

    if (nivel === "ok") nivel = "warning";

  }


  atualizarPainelDiagnostico(
    lista,
    nivel,
    textoSaude
  );


  console.log("Última leitura:", atual);

  console.log("Estado do motor:", estadoMotor);

  console.log("Referência operacional:", referenciaOperacional);

  console.log("Relatório de condição:", lista);

}


// ==============================================================================
// ESCUTA DO FIREBASE EM TEMPO REAL
// ==============================================================================

function escutarLeiturasEmTempoReal() {

  leiturasRef.on("value", snapshot => {

    const leituras = obterLeituras(snapshot);

    ultimoRecebimento = Date.now();

    alertaTimeoutExibido = false;

    processarLeituras(leituras);

  }, erro => {

    console.error("Erro na leitura do Firebase:", erro);

    tratarEstadoSemSinal(
      "Erro ao receber dados do Firebase"
    );

  });

}


// ==============================================================================
// TIMEOUT DE TELEMETRIA
// ==============================================================================

setInterval(() => {

  if (ultimoRecebimento === null) return;

  const tempoSemDados = Date.now() - ultimoRecebimento;

  if (
    tempoSemDados > CONFIG.intervaloTimeout &&
    !alertaTimeoutExibido
  ) {

    alertaTimeoutExibido = true;

    tratarEstadoSemSinal(
      "Sinal de telemetria interrompido"
    );

  }

}, 2000);


// ==============================================================================
// INICIALIZACAO
// ==============================================================================

monitorarStatusConexao();

escutarLeiturasEmTempoReal();

console.log("MoniMotor iniciado.");

// ==============================================================================
// MONIMOTOR: AMBIENTE DE TESTES
// ==============================================================================

const INTERVALO_TESTE_MS = 5000;

// Estado do simulador.

let simulacaoAtiva = false;
let simulacaoTimer = null;
let inicioSimulacao = 0;
let contadorTeste = 0;
let enviandoSimulacao = false;

// Anomalias independentes.

const anomaliasTeste = {

  temperatura: false,

  rpm: false,

  corrente: false,

  vibracao: false

};


// ==============================================================================
// GERENCIAMENTO DA INTERFACE DE TESTES
// ==============================================================================

function atualizarInterfaceTeste() {

  const badge = document.getElementById("test-mode-status");

  const botao = document.getElementById("test-toggle-button");

  const reset = document.getElementById("test-reset-button");

  if (!badge || !botao || !reset) return;

  badge.textContent = simulacaoAtiva
    ? "Simulação ativa"
    : "Simulação inativa";

  badge.className = simulacaoAtiva
    ? "badge online"
    : "badge health-unknown";

  botao.textContent = simulacaoAtiva
    ? "Interromper simulação (ESPAÇO)"
    : "Iniciar simulação (ESPAÇO)";

  botao.classList.toggle("running", simulacaoAtiva);

  const referenciaPronta = referenciaOperacional !== null;

  document.querySelectorAll(".test-anomaly-button").forEach(botaoAnomalia => {

    const tipo = botaoAnomalia.dataset.anomalia;

    const ativa = Boolean(anomaliasTeste[tipo]);

    botaoAnomalia.disabled =
      !simulacaoAtiva || !referenciaPronta;

    botaoAnomalia.classList.toggle("active", ativa);

    botaoAnomalia.setAttribute(
      "aria-pressed",
      String(ativa)
    );

    const titulos = {
      temperatura: "Temperatura elevada",
      rpm: "Queda de rotação",
      corrente: "Sobrecorrente",
      vibracao: "Vibração elevada"
    };

    botaoAnomalia.querySelector("strong").textContent =
      ativa
        ? titulos[tipo] + " [ATIVA]"
        : titulos[tipo];

  });

  reset.disabled = !simulacaoAtiva;

}


function atualizarEstadoReferencia(pronta, quantidade) {

  const elemento = document.getElementById(
    "test-reference-status"
  );

  if (!elemento) return;

  if (pronta) {

    elemento.textContent =
      "Referência estabelecida com 10 amostras normais. Os testes de anomalia estão liberados.";

  } else {

    elemento.textContent =
      `Coletando referência: ${quantidade} de ${CONFIG.amostrasReferencia} amostras normais.`;

  }

  atualizarInterfaceTeste();

}


// ==============================================================================
// GERACAO DE DADOS SIMULADOS
// ==============================================================================

function gerarDadosSimulados() {

  const tempo = (Date.now() - inicioSimulacao) / 1000;

  // --------------------------------------------------------------------------
  // CENARIO NORMAL
  // Motor de indução de quatro polos, 60 Hz.
  // --------------------------------------------------------------------------

  let temperatura =
    45.0 +
    0.25 * Math.sin(tempo * 0.15) +
    0.10 * Math.sin(tempo * 0.33);

  let rpm =
    1750 +
    6 * Math.sin(tempo * 0.20) +
    2 * Math.sin(tempo * 0.70);

  let corrente =
    10.0 +
    0.12 * Math.sin(tempo * 0.15) +
    0.05 * Math.sin(tempo * 0.61);

  let vibracaoRMS =
    0.95 +
    0.04 * Math.sin(tempo * 0.90) +
    0.02 * Math.sin(tempo * 0.31);


  // --------------------------------------------------------------------------
  // ANOMALIA: TEMPERATURA
  // --------------------------------------------------------------------------

  if (anomaliasTeste.temperatura) {

    temperatura =
      53.0 + 0.20 * Math.sin(tempo * 0.10);

  }


  // --------------------------------------------------------------------------
  // ANOMALIA: RPM
  // --------------------------------------------------------------------------

  if (anomaliasTeste.rpm) {

    rpm =
      1450 + 4 * Math.sin(tempo * 0.25);

  }


  // --------------------------------------------------------------------------
  // ANOMALIA: CORRENTE
  // --------------------------------------------------------------------------

  if (anomaliasTeste.corrente) {

    corrente =
      13.2 + 0.10 * Math.sin(tempo * 0.50);

  }


  // --------------------------------------------------------------------------
  // ANOMALIA: VIBRACAO
  // --------------------------------------------------------------------------

  if (anomaliasTeste.vibracao) {

    vibracaoRMS =
      1.75 + 0.04 * Math.sin(tempo * 0.70);

  }


  // Pico ilustrativo, sempre acima do RMS.
  const vibracaoPico =
    vibracaoRMS * 1.65 +
    0.04 * Math.abs(Math.sin(tempo * 1.10));


  // Um ímã = um pulso por volta.
  // Contagem correspondente ao intervalo de cinco segundos.
  const pulsosHall = Math.round(
    rpm * (INTERVALO_TESTE_MS / 60000)
  );


  return {

    temperatura: Number(temperatura.toFixed(2)),

    rpm: Math.round(rpm),

    corrente: Number(corrente.toFixed(3)),

    vibracao_rms_z: Number(vibracaoRMS.toFixed(3)),

    vibracao_pico_z: Number(vibracaoPico.toFixed(3)),

    pulsos_hall: pulsosHall,

    timestamp: firebase.database.ServerValue.TIMESTAMP,

    modo: "simulacao",

    corrente_tipo: "AC_RMS",

    sensor_ds18b20_ok: true,

    sensor_mpu6050_ok: true,

    sensor_acs712_ok: true,

    sensor_hall_ok: true,

    sessao_teste: sessaoTesteAtual

  };

}


// ==============================================================================
// ENVIO DE UMA AMOSTRA SIMULADA
// ==============================================================================

async function enviarDadosSimulados() {

  if (!simulacaoAtiva || enviandoSimulacao) return;

  enviandoSimulacao = true;

  try {

    contadorTeste++;

    const dados = gerarDadosSimulados();

    // Gera uma chave nova para cada leitura.
    const novaReferencia = database.ref("leituras").push();

    await novaReferencia.set(dados);

    const hora = new Date().toLocaleTimeString("pt-BR");

    const feedback = document.getElementById("test-feedback");

    if (feedback) {

      feedback.textContent =
        `Amostra ${contadorTeste} enviada às ${hora}`;

    }

    console.log("SIMULAÇÃO ENVIADA:", dados);

    console.log("ID FIREBASE:", novaReferencia.key);

  } catch (erro) {

    console.error("Falha ao enviar simulação:", erro);

    const feedback = document.getElementById("test-feedback");

    if (feedback) {

      feedback.textContent =
        "Erro Firebase: " + erro.message;

    }

  } finally {

    enviandoSimulacao = false;

  }

}


// ==============================================================================
// INICIAR E PARAR SIMULAÇÃO
// ==============================================================================

function iniciarSimulacao() {

  if (simulacaoAtiva) return;

  if (!firebase.apps.length) {

    alert("Firebase não foi inicializado.");

    return;
  }

  simulacaoAtiva = true;

  inicioSimulacao = Date.now();

  contadorTeste = 0;

  referenciaOperacional = null;

  sessaoTesteAtual =
    "teste_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8);


  // Inicia todas as anomalias desligadas.
  Object.keys(anomaliasTeste).forEach(tipo => {
    anomaliasTeste[tipo] = false;
  });


  atualizarInterfaceTeste();

  atualizarEstadoReferencia(false, 0);

  const feedback = document.getElementById("test-feedback");

  feedback.textContent =
    "Simulação iniciada. Coletando dados normais...";


  // Primeira leitura imediata.
  enviarDadosSimulados();


  // Próximas leituras a cada cinco segundos.
  simulacaoTimer = setInterval(
    enviarDadosSimulados,
    INTERVALO_TESTE_MS
  );


  console.log("SESSÃO DE TESTE:", sessaoTesteAtual);

}


function pararSimulacao() {

  if (!simulacaoAtiva) return;

  simulacaoAtiva = false;

  if (simulacaoTimer !== null) {

    clearInterval(simulacaoTimer);

    simulacaoTimer = null;

  }


  Object.keys(anomaliasTeste).forEach(tipo => {
    anomaliasTeste[tipo] = false;
  });


  atualizarInterfaceTeste();

  const feedback = document.getElementById("test-feedback");

  feedback.textContent =
    "Simulação interrompida. Os registros enviados continuam armazenados no Firebase.";


  console.log("SIMULAÇÃO INTERROMPIDA.");

}


function alternarSimulacao() {

  if (simulacaoAtiva) {

    pararSimulacao();

  } else {

    iniciarSimulacao();

  }

}


// ==============================================================================
// ATIVAR E DESATIVAR ANOMALIAS
// ==============================================================================

function alternarAnomalia(tipo) {

  if (!simulacaoAtiva) return;

  if (referenciaOperacional === null) {

    const feedback = document.getElementById("test-feedback");

    feedback.textContent =
      "Aguarde a coleta das 10 amostras normais.";

    return;

  }

  if (!Object.prototype.hasOwnProperty.call(anomaliasTeste, tipo)) {
    return;
  }

  anomaliasTeste[tipo] = !anomaliasTeste[tipo];

  atualizarInterfaceTeste();

  const nome = {

    temperatura: "Temperatura",

    rpm: "Rotação RPM",

    corrente: "Corrente ACS712",

    vibracao: "Aceleração MPU6050"

  };

  const feedback = document.getElementById("test-feedback");

  feedback.textContent =
    `${nome[tipo]}: ${
      anomaliasTeste[tipo] ? "ANOMALIA ATIVADA" : "CONDIÇÃO NORMAL RESTAURADA"
    }. A próxima leitura será enviada em até 5 segundos.`;


  console.log(
    "ANOMALIAS ATIVAS:",
    { ...anomaliasTeste }
  );

}


// ==============================================================================
// RESTAURAR TODOS OS SENSORES
// ==============================================================================

function restaurarOperacaoNormal() {

  if (!simulacaoAtiva) return;

  Object.keys(anomaliasTeste).forEach(tipo => {
    anomaliasTeste[tipo] = false;
  });

  atualizarInterfaceTeste();

  const feedback = document.getElementById("test-feedback");

  feedback.textContent =
    "Todas as anomalias foram desativadas. Retornando aos valores normais.";

  console.log("TODAS AS ANOMALIAS RESTAURADAS.");

}


// ==============================================================================
// EVENTOS DOS BOTOES
// ==============================================================================

document
  .getElementById("test-toggle-button")
  .addEventListener("click", alternarSimulacao);


document
  .getElementById("test-reset-button")
  .addEventListener("click", restaurarOperacaoNormal);


document
  .querySelectorAll(".test-anomaly-button")
  .forEach(botao => {

    botao.addEventListener("click", () => {

      alternarAnomalia(botao.dataset.anomalia);

    });

  });


// ==============================================================================
// ATALHO DE TECLADO: ESPAÇO
// ==============================================================================

document.addEventListener("keydown", event => {

  if (event.code !== "Space") return;

  if (event.repeat) return;

  const elemento = event.target;

  // Não intercepta a barra de espaço quando o usuário está
  // escrevendo ou acionando outro botão do site.

  const tag = elemento.tagName?.toLowerCase();

  if (
    ["input", "textarea", "select", "button"].includes(tag) ||
    elemento.isContentEditable
  ) {
    return;
  }

  event.preventDefault();

  alternarSimulacao();

});


// Estado inicial dos controles.
atualizarInterfaceTeste();