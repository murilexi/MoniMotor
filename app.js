
/* ============================================================================
   MONIMOTOR
   Dashboard de monitoramento de motores industriais
   Firebase Realtime Database + Chart.js
============================================================================ */


/* ============================================================================
   1. CONFIGURACAO FIREBASE
============================================================================ */

const firebaseConfig = {
  apiKey: "SUA_API_KEY_ORIGINAL",
  authDomain: "upx2---projeto.firebaseapp.com",
  databaseURL: "https://upx2---projeto-default-rtdb.firebaseio.com/",
  projectId: "upx2---projeto",
  storageBucket: "upx2---projeto.firebasestorage.app",
  messagingSenderId: "320149787397",
  appId: "SEU_APP_ID_ORIGINAL",
  measurementId: "G-QYFFSXY1GT"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();


/* ============================================================================
   2. CONFIGURACOES GERAIS
============================================================================ */

const CONFIG = {

  quantidadeAmostras: 20,
  quantidadeHistorico: 10,

  intervaloTimeout: 15000,
  intervaloSimulacao: 5000,

  amostrasReferencia: 10,
  amostrasPersistencia: 3,

  rpmMinimoOperacao: 30,
  correnteMinimaOperacao: 0.25,

  aumentoTemperatura: 4.0,

  aumentoCorrentePercentual: 0.25,
  aumentoCorrenteAbsoluto: 0.5,

  aumentoVibracaoPercentual: 0.50,
  aumentoVibracaoAbsoluto: 0.30,

  quedaRPMPercentual: 0.12,

  variacaoRPM: 0.08,
  variacaoCorrente: 0.20

};


/* ============================================================================
   3. ESTADOS GLOBAIS
============================================================================ */

let ultimoRecebimento = null;

let referenciaOperacional = null;
let identificadorReferencia = null;

let alertaTimeoutExibido = false;

let grafico = null;

// Ambiente de testes

let simulacaoAtiva = false;
let simulacaoTimer = null;
let sessaoTesteAtual = null;

let contadorTeste = 0;
let enviandoSimulacao = false;
let inicioSimulacao = 0;

// Anomalias independentes

const anomaliasTeste = {

  temperatura: false,
  rpm: false,
  corrente: false,
  vibracao: false

};


/* ============================================================================
   4. FUNCOES AUXILIARES
============================================================================ */

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

  if (dado.sensor_ds18b20_ok === false) return null;

  const valor = numeroValido(dado.temperatura);

  if (valor === null || valor < -55 || valor > 125) {
    return null;
  }

  return valor;

}


function obterRPM(dado) {

  const valor = numeroValido(dado.rpm);

  if (valor === null || valor < 0 || valor > 50000) {
    return null;
  }

  return valor;

}


function obterCorrente(dado) {

  if (dado.sensor_acs712_ok === false) return null;

  const valor = numeroValido(dado.corrente);

  if (valor === null || valor < 0 || valor > 100) {
    return null;
  }

  return valor;

}


function obterVibracao(dado) {

  if (dado.sensor_mpu6050_ok === false) return null;

  return (
    numeroValido(dado.vibracao_rms_z) ??
    numeroValido(dado.acel_rms_z) ??
    numeroValido(dado.vibracao_pico_z) ??
    numeroValido(dado.acel_z)
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


function converterTimestamp(valor) {

  const numero = numeroValido(valor);

  if (numero === null) return null;

  if (numero >= 1000000000000) return numero;

  if (numero >= 1000000000) return numero * 1000;

  return null;

}


function formatarHora(timestamp) {

  const tempo = converterTimestamp(timestamp);

  if (tempo === null) return "--:--:--";

  return new Date(tempo).toLocaleTimeString("pt-BR");

}


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

  const media = validos.reduce(
    (soma, valor) => soma + valor,
    0
  ) / validos.length;

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

  return leituras
    .slice(-CONFIG.amostrasPersistencia)
    .every(dado => {

      const valor = seletor(dado);

      return valor !== null && condicao(valor);

    });

}


/* ============================================================================
   5. IDENTIFICACAO DOS REGISTROS FIREBASE
============================================================================ */

function ehRegistro(dado) {

  if (
    !dado ||
    typeof dado !== "object" ||
    Array.isArray(dado)
  ) {
    return false;
  }

  const camposSensor = [
    "temperatura",
    "rpm",
    "corrente",
    "vibracao_rms_z",
    "vibracao_pico_z",
    "acel_rms_z",
    "acel_z"
  ];

  // O registro individual possui valores escalares.
  // Um agrupador de PUSH contém outros objetos.

  return camposSensor.some(campo => {

    if (!Object.prototype.hasOwnProperty.call(dado, campo)) {
      return false;
    }

    const valor = dado[campo];

    return (
      valor !== null &&
      typeof valor !== "object" &&
      Number.isFinite(Number(valor))
    );

  });

}


function obterLeituras(snapshot) {

  const dados = snapshot.val();

  if (!dados || typeof dados !== "object") {
    return [];
  }

  const registros = [];


  function percorrer(no, caminho) {

    if (
      !no ||
      typeof no !== "object" ||
      Array.isArray(no)
    ) {
      return;
    }

    // Se encontramos um registro válido, não percorremos
    // seus campos internos novamente.

    if (ehRegistro(no)) {

      registros.push({
        ...no,
        _key: caminho
      });

      return;

    }

    // Caso seja um agrupador, percorremos seus filhos.

    Object.entries(no).forEach(([chave, valor]) => {

      if (
        valor !== null &&
        typeof valor === "object" &&
        !Array.isArray(valor)
      ) {

        const novoCaminho = caminho
          ? caminho + "/" + chave
          : chave;

        percorrer(valor, novoCaminho);

      }

    });

  }


  percorrer(dados, "");


  // Remove eventuais duplicações.

  const unicos = new Map();

  registros.forEach(registro => {
    unicos.set(registro._key, registro);
  });


  const resultado = [...unicos.values()];


  // Ordena cronologicamente.

  resultado.sort((a, b) => {

    const tempoA = converterTimestamp(a.timestamp);
    const tempoB = converterTimestamp(b.timestamp);

    if (tempoA !== null && tempoB !== null) {
      return tempoA - tempoB;
    }

    return String(a._key).localeCompare(String(b._key));

  });


  return resultado.slice(-CONFIG.quantidadeAmostras);

}


/* ============================================================================
   6. SELECAO DA SESSAO DE DADOS
============================================================================ */

function chaveDaSessao(dado) {

  if (dado.modo === "simulacao") {

    return "simulacao:" + (
      dado.sessao_teste || "sem_sessao"
    );

  }

  return "real";

}


function selecionarLeiturasVisiveis(leituras) {

  if (leituras.length === 0) return [];


  // Durante um teste, somente a sessão atual será apresentada.

  if (simulacaoAtiva && sessaoTesteAtual) {

    return leituras.filter(dado =>
      dado.modo === "simulacao" &&
      dado.sessao_teste === sessaoTesteAtual
    );

  }


  const ultima = leituras[leituras.length - 1];


  // Se o navegador foi atualizado durante uma sessão de teste,
  // recupera a sessão mais recente sem exibir sua origem.

  if (
    ultima.modo === "simulacao" &&
    ultima.sessao_teste
  ) {

    sessaoTesteAtual = ultima.sessao_teste;

    return leituras.filter(dado =>
      dado.modo === "simulacao" &&
      dado.sessao_teste === sessaoTesteAtual
    );

  }


  // No monitoramento normal, não mistura simulações antigas
  // com as leituras físicas mais recentes.

  return leituras.filter(dado =>
    dado.modo !== "simulacao"
  );

}


/* ============================================================================
   7. MONITORAMENTO DA CONEXAO FIREBASE
============================================================================ */

function monitorarStatusConexao() {

  database.ref(".info/connected").on("value", snapshot => {

    const online = snapshot.val() === true;

    const status = document.getElementById("status-text");

    const badge = document.getElementById("status-badge");

    if (!status || !badge) return;

    status.textContent = online
      ? "Online"
      : "Desconectado";

    badge.className = online
      ? "badge online"
      : "badge offline";

    console.log(
      "[FIREBASE]",
      online ? "ONLINE" : "OFFLINE"
    );

  }, erro => {

    console.error("[FIREBASE] Erro de conexão:", erro);

  });

}


/* ============================================================================
   8. GRAFICO CHART.JS
============================================================================ */

function inicializarGrafico() {

  const canvas = document.getElementById("graficoLeituras");

  if (!canvas) {

    console.error("[GRÁFICO] Canvas não encontrado.");

    return;

  }

  if (typeof Chart === "undefined") {

    console.error("[GRÁFICO] Chart.js não carregado.");

    return;

  }

  grafico = new Chart(canvas.getContext("2d"), {

    type: "line",

    data: {

      labels: [],

      datasets: [

        {
          label: "Temperatura (°C)",
          data: [],
          yAxisID: "yTemperatura",
          borderColor: "#0099ff",
          backgroundColor: "#0099ff",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "RPM",
          data: [],
          yAxisID: "yRPM",
          borderColor: "#00e676",
          backgroundColor: "#00e676",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "Corrente RMS (A)",
          data: [],
          yAxisID: "yCorrente",
          borderColor: "#ffb300",
          backgroundColor: "#ffb300",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: 0.2,
          spanGaps: false
        },

        {
          label: "Aceleração RMS Z (m/s²)",
          data: [],
          yAxisID: "yVibracao",
          borderColor: "#ff3333",
          backgroundColor: "#ff3333",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 5,
          tension: 0.2,
          spanGaps: false
        }

      ]

    },

    options: {

      responsive: true,

      maintainAspectRatio: false,

      animation: false,

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
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
            font: {
              family: "Fira Code",
              size: 10
            }
          }

        },

        yTemperatura: {

          type: "linear",
          position: "left",

          title: {
            display: true,
            text: "Temperatura °C",
            color: "#0099ff"
          },

          ticks: {
            color: "#0099ff"
          },

          grid: {
            color: "#1a1a1a"
          }

        },

        yRPM: {

          type: "linear",
          position: "right",

          title: {
            display: true,
            text: "RPM",
            color: "#00e676"
          },

          ticks: {
            color: "#00e676"
          },

          grid: {
            drawOnChartArea: false
          }

        },

        yCorrente: {

          type: "linear",
          position: "right",
          offset: true,

          title: {
            display: true,
            text: "Corrente A",
            color: "#ffb300"
          },

          ticks: {
            color: "#ffb300"
          },

          grid: {
            drawOnChartArea: false
          }

        },

        yVibracao: {

          type: "linear",
          position: "left",
          offset: true,

          title: {
            display: true,
            text: "Aceleração m/s²",
            color: "#ff3333"
          },

          ticks: {
            color: "#ff3333"
          },

          grid: {
            drawOnChartArea: false
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

        },

        tooltip: {
          enabled: true,
          mode: "index",
          intersect: false
        }

      }

    }

  });

  console.log("[GRÁFICO] Inicializado.");

}


/* ============================================================================
   9. ATUALIZACAO DOS CARDS
============================================================================ */

function atualizarCards(dado) {

  const temperatura = obterTemperatura(dado);

  const rpm = obterRPM(dado);

  const corrente = obterCorrente(dado);

  const vibracao = obterVibracao(dado);

  const hora = formatarHora(dado.timestamp);


  document.getElementById("val-temp").textContent =
    temperatura !== null
      ? temperatura.toFixed(2)
      : "--";


  document.getElementById("val-rpm").textContent =
    rpm !== null
      ? rpm.toLocaleString("pt-BR")
      : "--";


  document.getElementById("val-corrente").textContent =
    corrente !== null
      ? corrente.toFixed(2)
      : "--";


  document.getElementById("val-acel").textContent =
    vibracao !== null
      ? vibracao.toFixed(3)
      : "--";


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


/* ============================================================================
   10. ATUALIZACAO DO GRAFICO
============================================================================ */

function atualizarGrafico(leituras) {

  if (!grafico) {

    console.error("[GRÁFICO] Instância não inicializada.");

    return;

  }

  grafico.data.labels = leituras.map(
    dado => formatarHora(dado.timestamp)
  );


  grafico.data.datasets[0].data = leituras.map(
    dado => obterTemperatura(dado)
  );


  grafico.data.datasets[1].data = leituras.map(
    dado => obterRPM(dado)
  );


  grafico.data.datasets[2].data = leituras.map(
    dado => obterCorrente(dado)
  );


  grafico.data.datasets[3].data = leituras.map(
    dado => obterVibracao(dado)
  );


  grafico.update("none");


  console.log(
    "[GRÁFICO] Atualizado com",
    leituras.length,
    "amostras."
  );

}


/* ============================================================================
   11. HISTORICO DE LEITURAS
============================================================================ */

function renderizarHistorico(leituras) {

  const corpo = document.getElementById("history-body");

  const contador = document.getElementById("history-count");

  if (!corpo || !contador) return;


  corpo.replaceChildren();


  if (leituras.length === 0) {

    const linha = document.createElement("tr");

    const celula = document.createElement("td");

    celula.colSpan = 6;

    celula.className = "history-empty";

    celula.textContent =
      "Aguardando primeiras leituras...";

    linha.appendChild(celula);

    corpo.appendChild(linha);

    contador.textContent = "0 amostras";

    return;

  }


  const recentes = [...leituras]
    .reverse()
    .slice(0, CONFIG.quantidadeHistorico);


  recentes.forEach(dado => {

    const linha = document.createElement("tr");

    const origem = "—";


    const valores = [

      formatarHora(dado.timestamp),

      obterTemperatura(dado) !== null
        ? obterTemperatura(dado).toFixed(2) + " °C"
        : "--",

      obterRPM(dado) !== null
        ? obterRPM(dado).toLocaleString("pt-BR")
        : "--",

      obterCorrente(dado) !== null
        ? obterCorrente(dado).toFixed(2) + " A"
        : "--",

      obterVibracao(dado) !== null
        ? obterVibracao(dado).toFixed(3) + " m/s²"
        : "--",

      origem

    ];


    valores.forEach((valor, indice) => {

      const celula = document.createElement("td");

      celula.textContent = valor;

      if (indice === 5) {
        celula.className = "history-origin";
      }

      linha.appendChild(celula);

    });


    corpo.appendChild(linha);

  });


  contador.textContent =
    `${recentes.length} últimas amostras`;


  console.log(
    "[HISTÓRICO] Atualizado:",
    recentes.length,
    "registros."
  );

}


/* ============================================================================
   12. ESTADO OPERACIONAL DO MOTOR
============================================================================ */

function identificarEstadoMotor(dado) {

  const rpm = obterRPM(dado);

  const corrente = obterCorrente(dado);

  if (rpm === null || corrente === null) {
    return "indeterminado";
  }

  const rotacaoAtiva =
    rpm > CONFIG.rpmMinimoOperacao;

  const correnteAtiva =
    corrente > CONFIG.correnteMinimaOperacao;


  if (!rotacaoAtiva && !correnteAtiva) {
    return "parado";
  }

  if (rotacaoAtiva && correnteAtiva) {
    return "operando";
  }

  if (!rotacaoAtiva && correnteAtiva) {
    return "corrente_sem_rotacao";
  }

  return "inconsistente";

}


/* ============================================================================
   13. REFERENCIA OPERACIONAL
============================================================================ */

function capturarReferencia(leituras) {

  if (leituras.length === 0) return null;


  const atual = leituras[leituras.length - 1];

  const chaveAtual = chaveDaSessao(atual);


  if (identificadorReferencia !== chaveAtual) {

    identificadorReferencia = chaveAtual;

    referenciaOperacional = null;

    console.log(
      "[ANÁLISE] Nova sessão. Referência reiniciada."
    );

    atualizarEstadoReferencia(false, 0);

  }


  if (referenciaOperacional !== null) {

    atualizarEstadoReferencia(
      true,
      CONFIG.amostrasReferencia
    );

    return referenciaOperacional;

  }


  const amostrasValidas = leituras.filter(dado => {

    const mesmaSessao =
      chaveDaSessao(dado) === chaveAtual;

    const semAnomalias =
      !Array.isArray(dado.anomalias_ativas) ||
      dado.anomalias_ativas.length === 0;

    return (
      mesmaSessao &&
      semAnomalias &&
      leituraCompleta(dado) &&
      identificarEstadoMotor(dado) === "operando"
    );

  });


  if (
    amostrasValidas.length <
    CONFIG.amostrasReferencia
  ) {

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

    temperatura: mediana(
      base.map(obterTemperatura)
    ),

    rpm: mediana(
      base.map(obterRPM)
    ),

    corrente: mediana(
      base.map(obterCorrente)
    ),

    vibracao: mediana(
      base.map(obterVibracao)
    )

  };


  console.log(
    "[ANÁLISE] REFERÊNCIA OPERACIONAL:",
    referenciaOperacional
  );


  atualizarEstadoReferencia(
    true,
    CONFIG.amostrasReferencia
  );


  return referenciaOperacional;

}


function atualizarEstadoReferencia(pronta, quantidade) {

  const elemento = document.getElementById(
    "test-reference-status"
  );

  if (elemento) {

    elemento.textContent = pronta
      ? "Referência operacional estabelecida. Testes disponíveis."
      : `Coletando referência: ${quantidade} de ${CONFIG.amostrasReferencia} amostras normais.`;

  }

  atualizarInterfaceTeste();

}


/* ============================================================================
   14. ANALISE DE CONDICAO DO MOTOR
============================================================================ */

function analisarSaudeDoMotor(leituras) {

  const diagnosticos = [];

  let nivelMaximo = "ok";

  const atual = leituras[leituras.length - 1];


  function adicionar(
    nivel,
    titulo,
    sensores,
    causa,
    acao
  ) {

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
  // FALHAS DE SENSORES
  // --------------------------------------------------------------------------

  if (atual.sensor_ds18b20_ok === false) {

    adicionar(
      "warning",
      "FALHA NO SENSOR DE TEMPERATURA",
      "DS18B20",
      "Não foi recebida uma temperatura válida.",
      "Verificar alimentação, cabeamento, resistor de pull-up, conexão DATA e integridade do sensor."
    );

  }


  if (atual.sensor_mpu6050_ok === false) {

    adicionar(
      "warning",
      "FALHA DE COMUNICAÇÃO COM MPU6050",
      "MPU6050",
      "A aquisição de aceleração não está disponível.",
      "Verificar alimentação, SDA, SCL, endereço I2C e fixação do módulo."
    );

  }


  if (atual.sensor_acs712_ok === false) {

    adicionar(
      "warning",
      "FALHA NA LEITURA DO ACS712",
      "ACS712",
      "A leitura analógica foi considerada inválida.",
      "Verificar alimentação, divisor de tensão, aterramento e calibração."
    );

  }


  if (atual.sensor_hall_ok === false) {

    adicionar(
      "warning",
      "FALHA NO SENSOR HALL",
      "Hall",
      "A contagem de pulsos não está disponível.",
      "Verificar alimentação, saída digital, distância do ímã e conexão ao ESP32."
    );

  }


  // --------------------------------------------------------------------------
  // REFERENCIA
  // --------------------------------------------------------------------------

  const referencia = capturarReferencia(leituras);


  if (referencia === null) {

    adicionar(
      "ok",
      "COLETANDO REFERÊNCIA OPERACIONAL",
      "DS18B20 + Hall + ACS712 + MPU6050",
      "Ainda não há dez amostras completas em operação normal.",
      "Manter condições estáveis durante a coleta. A comparação relativa será iniciada quando a referência estiver pronta."
    );

    return {
      diagnosticos,
      nivelMaximo,
      referencia: null
    };

  }


  // --------------------------------------------------------------------------
  // TEMPERATURA
  // --------------------------------------------------------------------------

  const temperaturaAlta = persistenciaConfirmada(
    leituras,
    obterTemperatura,
    valor =>
      valor >= referencia.temperatura +
      CONFIG.aumentoTemperatura
  );


  // --------------------------------------------------------------------------
  // CORRENTE
  // --------------------------------------------------------------------------

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


  // --------------------------------------------------------------------------
  // ROTACAO
  // --------------------------------------------------------------------------

  const rpmBaixo = persistenciaConfirmada(
    leituras,
    obterRPM,
    valor =>
      valor <= referencia.rpm *
      (1 - CONFIG.quedaRPMPercentual)
  );


  // --------------------------------------------------------------------------
  // VIBRACAO
  // --------------------------------------------------------------------------

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
  // CORRENTE + ROTACAO
  // --------------------------------------------------------------------------

  if (correnteAlta && rpmBaixo) {

    adicionar(
      "warning",
      "AUMENTO DE CARGA COM REDUÇÃO DE ROTAÇÃO",
      "ACS712 + Hall",
      "A corrente RMS aumentou enquanto a rotação caiu persistentemente. Pode haver aumento de carga, atrito mecânico ou alteração no acionamento.",
      "Verificar corrente nominal, alimentação, carga acionada, acoplamento e rolamentos. Confirmar a rotação com tacômetro independente."
    );

  } else {

    if (correnteAlta) {

      adicionar(
        "warning",
        "AUMENTO PERSISTENTE DE CORRENTE",
        "ACS712",
        "A corrente RMS permaneceu acima da referência operacional.",
        "Comparar com a corrente nominal da placa e um alicate amperímetro. Investigar carga, tensão, conexões e acionamento."
      );

    }


    if (rpmBaixo) {

      adicionar(
        "warning",
        "REDUÇÃO PERSISTENTE DE ROTAÇÃO",
        "Sensor Hall",
        "A rotação permaneceu abaixo da referência operacional.",
        "Verificar carga mecânica, acionamento, posição do ímã, distância do sensor e contagem de pulsos."
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
      "A temperatura permaneceu pelo menos 4 °C acima da referência operacional.",
      "Inspecionar ventilação, fluxo de ar, aletas, carga mecânica e fixação do sensor. Comparar com o limite térmico do fabricante."
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
      "A temperatura aumentou simultaneamente à corrente RMS.",
      "Verificar carga, ventilação, conexões elétricas e rolamentos. Confirmar medições com instrumentos independentes."
    );

  }


  // --------------------------------------------------------------------------
  // VIBRACAO
  // --------------------------------------------------------------------------

  if (vibracaoAlta) {

    adicionar(
      "warning",
      "AUMENTO PERSISTENTE DE ACELERAÇÃO",
      "MPU6050",
      "A aceleração RMS dinâmica no eixo Z ultrapassou a referência operacional.",
      "Verificar fixação do sensor, base, acoplamento e rolamentos. Complementar a medição com os três eixos e análise de frequência."
    );

  }


  // --------------------------------------------------------------------------
  // INSTABILIDADE
  // --------------------------------------------------------------------------

  if (leituras.length >= 5) {

    const ultimas = leituras.slice(-5);

    const valoresRPM = ultimas.map(obterRPM);

    const valoresCorrente = ultimas.map(obterCorrente);


    if (
      identificarEstadoMotor(atual) === "operando" &&
      coeficienteVariacao(valoresRPM) > CONFIG.variacaoRPM
    ) {

      adicionar(
        "warning",
        "OSCILAÇÃO DE ROTAÇÃO",
        "Hall",
        "A rotação apresentou variação relativa elevada nas últimas cinco amostras.",
        "Investigar variação de carga, acionamento, alimentação e qualidade da contagem de pulsos."
      );

    }


    if (
      identificarEstadoMotor(atual) === "operando" &&
      coeficienteVariacao(valoresCorrente) > CONFIG.variacaoCorrente
    ) {

      adicionar(
        "warning",
        "OSCILAÇÃO DE CORRENTE",
        "ACS712",
        "A corrente RMS apresentou variação relativa elevada nas últimas cinco amostras.",
        "Verificar carga, alimentação elétrica, conexões e estabilidade do acionamento."
      );

    }

  }


  // --------------------------------------------------------------------------
  // NORMALIDADE
  // --------------------------------------------------------------------------

  if (diagnosticos.length === 0) {

    adicionar(
      "ok",
      "SEM DESVIOS PERSISTENTES IDENTIFICADOS",
      "Todos os sensores",
      "Os parâmetros monitorados permaneceram próximos da referência operacional.",
      "Manter acompanhamento periódico e registrar as condições normais de operação. A ausência de anomalias não comprova ausência de falhas."
    );

  }


  return {
    diagnosticos,
    nivelMaximo,
    referencia
  };

}


/* ============================================================================
   15. PAINEL DE DIAGNOSTICO
============================================================================ */

function atualizarPainelDiagnostico(lista, nivel, mensagem) {

  const container =
    document.getElementById("diagnostic-container");

  const badge =
    document.getElementById("health-badge");

  const texto =
    document.getElementById("health-text");

  const contador =
    document.getElementById("diagnostic-count");

  if (!container || !badge || !texto || !contador) return;


  const classes = {

    ok: "health-ok",
    warning: "health-warning",
    danger: "health-danger",
    unknown: "health-unknown"

  };

  badge.className =
    "badge " + (classes[nivel] || classes.unknown);

  texto.textContent = mensagem;

  contador.textContent =
    `${lista.length} ${lista.length === 1 ? "análise" : "análises"}`;


  container.replaceChildren();


  lista.forEach(item => {

    const card = document.createElement("div");

    card.className = `diag-card ${item.nivel}`;


    const titulo = document.createElement("div");

    titulo.className = "diag-title";

    titulo.textContent = item.titulo;


    const sensores = document.createElement("div");

    sensores.className = "diag-desc";

    sensores.textContent =
      "Sensores: " + item.sensores;


    const causa = document.createElement("div");

    causa.className = "diag-desc";

    causa.textContent =
      "Relatório: " + item.causa;


    const acao = document.createElement("div");

    acao.className = "diag-action";

    acao.textContent =
      "Manutenção recomendada: " + item.acao;


    card.append(
      titulo,
      sensores,
      causa,
      acao
    );

    container.appendChild(card);

  });

}


/* ============================================================================
   16. ESTADOS SEM DADOS
============================================================================ */

function mostrarSemDados(mensagem) {

  const badge =
    document.getElementById("health-badge");

  const texto =
    document.getElementById("health-text");

  const contador =
    document.getElementById("diagnostic-count");

  const container =
    document.getElementById("diagnostic-container");


  if (badge) {
    badge.className = "badge health-unknown";
  }

  if (texto) {
    texto.textContent = mensagem;
  }

  if (contador) {
    contador.textContent = "Sem medições recentes";
  }


  if (container) {

    container.replaceChildren();

    const card = document.createElement("div");

    card.className = "diag-card";


    const titulo = document.createElement("div");

    titulo.className = "diag-title";

    titulo.textContent = mensagem.toUpperCase();


    const descricao = document.createElement("div");

    descricao.className = "diag-desc";

    descricao.textContent =
      "Não existem leituras recentes suficientes para avaliar a condição do motor.";


    const acao = document.createElement("div");

    acao.className = "diag-action";

    acao.textContent =
      "Verificar conexão, ESP32 e transmissão de dados ao Firebase.";


    card.append(titulo, descricao, acao);

    container.appendChild(card);

  }

}


/* ============================================================================
   17. PROCESSAMENTO PRINCIPAL
============================================================================ */

function processarLeituras(leituras) {

  if (!Array.isArray(leituras) || leituras.length === 0) {

    limparCards();

    atualizarGrafico([]);

    renderizarHistorico([]);

    mostrarSemDados("Aguardando leituras do ESP32");

    return;

  }


  const atual = leituras[leituras.length - 1];


  // Atualização simultânea do dashboard.

  atualizarCards(atual);

  atualizarGrafico(leituras);

  renderizarHistorico(leituras);


  // Análise somente da sessão selecionada.

  const resultado = analisarSaudeDoMotor(leituras);

  const estado = identificarEstadoMotor(atual);

  const diagnosticos = [...resultado.diagnosticos];

  let nivel = resultado.nivelMaximo;

  let mensagem = "";


  // --------------------------------------------------
  // ESTADO OPERACIONAL
  // --------------------------------------------------

  if (estado === "operando") {

    if (nivel === "danger") {

      mensagem = "Prioridade alta de inspeção";

    } else if (nivel === "warning") {

      mensagem = "Desvio detectado";

    } else if (resultado.referencia === null) {

      mensagem = "Coletando referência";

    } else {

      mensagem = "Motor em operação";

    }

  } else if (estado === "parado") {

    mensagem = "Motor parado";

    if (nivel === "ok") {
      nivel = "unknown";
    }

  } else if (estado === "corrente_sem_rotacao") {

    mensagem = "Corrente presente sem rotação";

    nivel = "warning";

    diagnosticos.unshift({

      nivel: "warning",

      titulo: "VERIFICAR POSSÍVEL BLOQUEIO OU FALHA DE ROTAÇÃO",

      sensores: "ACS712 + Hall",

      causa: "Existe corrente detectável, mas a rotação está abaixo do limite operacional configurado.",

      acao: "Verificar alimentação, acionamento, carga mecânica e funcionamento do sensor Hall."

    });

  } else {

    mensagem = "Estado operacional indeterminado";

  }


  // --------------------------------------------------
  // TELEMETRIA INCOMPLETA
  // --------------------------------------------------

  if (!leituraCompleta(atual)) {

    diagnosticos.unshift({

      nivel: "warning",

      titulo: "TELEMETRIA INCOMPLETA",

      sensores: "Um ou mais canais",

      causa: "Não foram recebidos todos os parâmetros necessários.",

      acao: "Verificar sensores, alimentação, fiação e comunicação."

    });

    if (nivel === "ok") {
      nivel = "warning";
    }

  }


  atualizarPainelDiagnostico(
    diagnosticos,
    nivel,
    mensagem
  );


  console.log("[DASHBOARD] Última leitura:", atual);

  console.log(
    "[DASHBOARD] Quantidade de amostras:",
    leituras.length
  );

  console.log("[ANÁLISE] Estado do motor:", estado);

  console.log("[ANÁLISE] Referência:", referenciaOperacional);

  console.log("[ANÁLISE] Diagnósticos:", diagnosticos);

}


/* ============================================================================
   18. ESCUTA DO FIREBASE
============================================================================ */

function escutarLeiturasEmTempoReal() {

  console.log("[FIREBASE] Monitorando /leituras...");


  database
    .ref("leituras")
    .orderByKey()
    .limitToLast(CONFIG.quantidadeAmostras)

    .on("value", snapshot => {

      console.log(
        "[FIREBASE] Registros encontrados:",
        snapshot.numChildren()
      );


      // Extrai corretamente os registros individuais.
      const todasLeituras = obterLeituras(snapshot);


      // Separa a sessão atual de dados.
      const leiturasVisiveis =
        selecionarLeiturasVisiveis(todasLeituras);


      console.log(
        "[FIREBASE] Leituras interpretadas:",
        todasLeituras.length
      );

      console.log(
        "[DASHBOARD] Leituras selecionadas:",
        leiturasVisiveis.length
      );


      if (leiturasVisiveis.length > 0) {

        console.table(
          leiturasVisiveis.map(dado => ({

            horario: formatarHora(dado.timestamp),

            temperatura: obterTemperatura(dado),

            rpm: obterRPM(dado),

            corrente: obterCorrente(dado),

            vibracao: obterVibracao(dado)

          }))
        );

      }


      ultimoRecebimento = Date.now();

      alertaTimeoutExibido = false;


      processarLeituras(leiturasVisiveis);

    }, erro => {

      console.error(
        "[FIREBASE] ERRO DE LEITURA:",
        erro
      );

      mostrarSemDados(
        "Erro ao receber dados do Firebase"
      );

    });

}


/* ============================================================================
   19. TIMEOUT DE TELEMETRIA
============================================================================ */

setInterval(() => {

  if (ultimoRecebimento === null) {

    return;

  }


  const tempoSemDados =
    Date.now() - ultimoRecebimento;


  if (
    tempoSemDados > CONFIG.intervaloTimeout &&
    !alertaTimeoutExibido
  ) {

    alertaTimeoutExibido = true;

    mostrarSemDados(
      "Sinal de telemetria interrompido"
    );

    console.warn(
      "[FIREBASE] Nenhuma atualização recebida dentro do intervalo."
    );

  }

}, 2000);


/* ============================================================================
   20. AMBIENTE DE TESTES: INTERFACE
============================================================================ */

function atualizarInterfaceTeste() {

  const badge =
    document.getElementById("test-mode-status");

  const botao =
    document.getElementById("test-toggle-button");

  const reset =
    document.getElementById("test-reset-button");


  if (badge) {

    badge.textContent = simulacaoAtiva
      ? "Ativo"
      : "Inativo";

    badge.className = simulacaoAtiva
      ? "badge online"
      : "badge health-unknown";

  }


  if (botao) {

    botao.textContent = simulacaoAtiva
      ? "Interromper envio (ESPAÇO)"
      : "Iniciar envio (ESPAÇO)";

    botao.classList.toggle(
      "running",
      simulacaoAtiva
    );

  }


  if (reset) {

    reset.disabled = !simulacaoAtiva;

  }


  const referenciaPronta =
    referenciaOperacional !== null;


  document
    .querySelectorAll(".test-anomaly-button")
    .forEach(botaoAnomalia => {

      const tipo = botaoAnomalia.dataset.anomalia;

      const ativa = Boolean(anomaliasTeste[tipo]);


      botaoAnomalia.disabled =
        !simulacaoAtiva || !referenciaPronta;


      botaoAnomalia.classList.toggle(
        "active",
        ativa
      );


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


      const titulo =
        botaoAnomalia.querySelector("strong");


      if (titulo) {

        titulo.textContent = ativa
          ? titulos[tipo] + " [ATIVA]"
          : titulos[tipo];

      }

    });

}


/* ============================================================================
   21. GERACAO DOS DADOS
============================================================================ */

function gerarDadosSimulados() {

  const tempo =
    (Date.now() - inicioSimulacao) / 1000;


  // CONDIÇÃO NORMAL

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


  // ANOMALIA: TEMPERATURA

  if (anomaliasTeste.temperatura) {

    temperatura =
      53.0 +
      0.20 * Math.sin(tempo * 0.10);

  }


  // ANOMALIA: RPM

  if (anomaliasTeste.rpm) {

    rpm =
      1450 +
      4 * Math.sin(tempo * 0.25);

  }


  // ANOMALIA: CORRENTE

  if (anomaliasTeste.corrente) {

    corrente =
      13.2 +
      0.10 * Math.sin(tempo * 0.50);

  }


  // ANOMALIA: VIBRAÇÃO

  if (anomaliasTeste.vibracao) {

    vibracaoRMS =
      1.75 +
      0.04 * Math.sin(tempo * 0.70);

  }


  const vibracaoPico =
    vibracaoRMS * 1.65 +
    0.04 * Math.abs(Math.sin(tempo * 1.10));


  // Um imã = um pulso por revolução.

  const pulsosHall = Math.round(
    rpm * CONFIG.intervaloSimulacao / 60000
  );


  const anomaliasAtivas = Object.keys(anomaliasTeste)
    .filter(tipo => anomaliasTeste[tipo]);


  return {

    temperatura: Number(temperatura.toFixed(2)),

    rpm: Math.round(rpm),

    corrente: Number(corrente.toFixed(3)),

    vibracao_rms_z: Number(vibracaoRMS.toFixed(3)),

    vibracao_pico_z: Number(vibracaoPico.toFixed(3)),

    pulsos_hall: pulsosHall,

    timestamp: firebase.database.ServerValue.TIMESTAMP,

    // Mantidos somente como metadados internos.
    modo: "simulacao",

    sessao_teste: sessaoTesteAtual,

    anomalias_ativas: anomaliasAtivas,

    corrente_tipo: "AC_RMS",

    sensor_ds18b20_ok: true,

    sensor_mpu6050_ok: true,

    sensor_acs712_ok: true,

    sensor_hall_ok: true

  };

}


/* ============================================================================
   22. ENVIO AO FIREBASE
============================================================================ */

async function enviarDadosSimulados() {

  if (!simulacaoAtiva || enviandoSimulacao) {
    return;
  }

  enviandoSimulacao = true;


  try {

    contadorTeste++;

    const dados = gerarDadosSimulados();


    // Uma chave própria para cada leitura.

    const novaReferencia =
      database.ref("leituras").push();


    await novaReferencia.set(dados);


    const feedback =
      document.getElementById("test-feedback");


    if (feedback) {

      feedback.textContent =
        `Leitura ${contadorTeste} enviada às ${
          new Date().toLocaleTimeString("pt-BR")
        }`;

    }


    console.log(
      "[DADOS] Leitura enviada:",
      dados
    );

    console.log(
      "[FIREBASE] ID:",
      novaReferencia.key
    );


  } catch (erro) {

    console.error(
      "[FIREBASE] Falha ao enviar:",
      erro
    );


    const feedback =
      document.getElementById("test-feedback");


    if (feedback) {

      feedback.textContent =
        "Falha no envio: " + erro.message;

    }

  } finally {

    enviandoSimulacao = false;

  }

}


/* ============================================================================
   23. INICIAR ENVIO
============================================================================ */

function iniciarSimulacao() {

  if (simulacaoAtiva) return;


  simulacaoAtiva = true;

  inicioSimulacao = Date.now();

  contadorTeste = 0;


  // Cada início recebe um identificador próprio.

  sessaoTesteAtual =
    "teste_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8);


  // Reinicia a referência.

  referenciaOperacional = null;

  identificadorReferencia = null;


  // Desativa todas as anomalias.

  Object.keys(anomaliasTeste).forEach(tipo => {

    anomaliasTeste[tipo] = false;

  });


  atualizarInterfaceTeste();

  atualizarEstadoReferencia(false, 0);


  const feedback =
    document.getElementById("test-feedback");


  if (feedback) {

    feedback.textContent =
      "Envio iniciado. Coletando dados operacionais.";

  }


  console.log(
    "[SESSÃO] Iniciada:",
    sessaoTesteAtual
  );


  // Primeira leitura imediata.

  enviarDadosSimulados();


  // Próximas amostras a cada cinco segundos.

  simulacaoTimer = setInterval(
    enviarDadosSimulados,
    CONFIG.intervaloSimulacao
  );

}


/* ============================================================================
   24. INTERROMPER ENVIO
============================================================================ */

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


  const feedback =
    document.getElementById("test-feedback");


  if (feedback) {

    feedback.textContent =
      "Envio interrompido. Os registros anteriores continuam armazenados.";

  }


  console.log("[SESSÃO] Interrompida.");

}


function alternarSimulacao() {

  if (simulacaoAtiva) {

    pararSimulacao();

  } else {

    iniciarSimulacao();

  }

}


/* ============================================================================
   25. ANOMALIAS
============================================================================ */

function alternarAnomalia(tipo) {

  if (!simulacaoAtiva) return;


  if (referenciaOperacional === null) {

    const feedback =
      document.getElementById("test-feedback");


    if (feedback) {

      feedback.textContent =
        "Aguardando a referência operacional.";

    }

    return;

  }


  if (!Object.prototype.hasOwnProperty.call(anomaliasTeste, tipo)) {
    return;
  }


  anomaliasTeste[tipo] =
    !anomaliasTeste[tipo];


  atualizarInterfaceTeste();


  const nomes = {

    temperatura: "Temperatura DS18B20",

    rpm: "Rotação Hall",

    corrente: "Corrente ACS712",

    vibracao: "Aceleração MPU6050"

  };


  const feedback =
    document.getElementById("test-feedback");


  if (feedback) {

    feedback.textContent =
      `${nomes[tipo]}: ${
        anomaliasTeste[tipo]
          ? "alteração ativada"
          : "condição normal restaurada"
      }.`;

  }


  console.log(
    "[TESTE] Estado das alterações:",
    { ...anomaliasTeste }
  );

}


function restaurarOperacaoNormal() {

  if (!simulacaoAtiva) return;


  Object.keys(anomaliasTeste).forEach(tipo => {

    anomaliasTeste[tipo] = false;

  });


  atualizarInterfaceTeste();


  const feedback =
    document.getElementById("test-feedback");


  if (feedback) {

    feedback.textContent =
      "Condições operacionais restauradas.";

  }


  console.log("[TESTE] Condições restauradas.");

}


/* ============================================================================
   26. EVENTOS DOS CONTROLES
============================================================================ */

function inicializarControlesTeste() {

  const botaoIniciar =
    document.getElementById("test-toggle-button");

  const botaoReset =
    document.getElementById("test-reset-button");


  if (botaoIniciar) {

    botaoIniciar.addEventListener(
      "click",
      alternarSimulacao
    );

  }


  if (botaoReset) {

    botaoReset.addEventListener(
      "click",
      restaurarOperacaoNormal
    );

  }


  document
    .querySelectorAll(".test-anomaly-button")
    .forEach(botao => {

      botao.addEventListener("click", () => {

        alternarAnomalia(
          botao.dataset.anomalia
        );

      });

    });


  atualizarInterfaceTeste();

}


/* ============================================================================
   27. ATALHO DE TECLADO
============================================================================ */

document.addEventListener("keydown", event => {

  if (event.code !== "Space") return;

  if (event.repeat) return;

  if (
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  ) {
    return;
  }


  const elemento = event.target;


  // Evita interceptar a tecla Espaço quando o usuário
  // estiver interagindo com campos ou botões.

  if (
    elemento.closest &&
    elemento.closest(
      "button, input, textarea, select, [contenteditable='true']"
    )
  ) {
    return;
  }


  event.preventDefault();

  alternarSimulacao();

});


/* ============================================================================
   28. INICIALIZACAO GERAL
============================================================================ */

function iniciarMoniMotor() {

  console.log("================================");

  console.log("MONIMOTOR");

  console.log("INICIALIZANDO DASHBOARD");

  console.log("================================");


  inicializarGrafico();

  monitorarStatusConexao();

  escutarLeiturasEmTempoReal();

  inicializarControlesTeste();


  console.log("[MONIMOTOR] Inicialização concluída.");

}


iniciarMoniMotor();
