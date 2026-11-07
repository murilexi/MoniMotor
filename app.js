// ============================================================================
// MONIMOTOR
// Dashboard de monitoramento industrial
// Firebase Realtime Database + Chart.js
// ============================================================================


// ============================================================================
// 1. FIREBASE
// ============================================================================

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

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

const database = firebase.database();


// ============================================================================
// 2. CONFIGURACOES
// ============================================================================

const CONFIG = {

  quantidadeAmostras: 20,
  quantidadeHistorico: 10,

  intervaloTimeout: 15000,
  intervaloSimulacao: 5000,

  amostrasReferencia: 10,
  amostrasPersistencia: 3,

  rpmMinimoOperacao: 30,
  correnteMinimaOperacao: 0.25,

  aumentoTemperatura: 4,

  aumentoCorrentePercentual: 0.25,
  aumentoCorrenteAbsoluto: 0.5,

  aumentoVibracaoPercentual: 0.50,
  aumentoVibracaoAbsoluto: 0.30,

  quedaRPMPercentual: 0.12,

  variacaoRPM: 0.08,
  variacaoCorrente: 0.20

};


// ============================================================================
// 3. ESTADOS GLOBAIS
// ============================================================================

let grafico = null;

let ultimoRecebimento = null;

let alertaTimeoutExibido = false;

let referenciaOperacional = null;
let identificadorReferencia = null;

let consultaAtiva = null;
let callbackConsulta = null;

let caminhoAtual = "leituras";

// Ambiente de demonstração

let demonstracaoAtiva = false;
let intervaloDemonstracao = null;

let sessaoDemonstracao = null;
let contadorDemonstracao = 0;

let enviandoDemonstracao = false;
let inicioDemonstracao = 0;

const anomalias = {
  temperatura: false,
  rpm: false,
  corrente: false,
  vibracao: false
};


// ============================================================================
// 4. FUNCOES AUXILIARES
// ============================================================================

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

  if (valor === null || valor < 0 || valor > 50000) {
    return null;
  }

  return valor;

}


function obterCorrente(dado) {

  if (dado.sensor_acs712_ok === false) {
    return null;
  }

  const valor = numeroValido(dado.corrente);

  if (valor === null || valor < 0 || valor > 100) {
    return null;
  }

  return valor;

}


function obterVibracao(dado) {

  if (dado.sensor_mpu6050_ok === false) {
    return null;
  }

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


// ============================================================================
// 5. IDENTIFICACAO DOS REGISTROS
// ============================================================================

function ehRegistro(dado) {

  if (
    !dado ||
    typeof dado !== "object" ||
    Array.isArray(dado)
  ) {
    return false;
  }

  const campos = [
    "temperatura",
    "rpm",
    "corrente",
    "vibracao_rms_z",
    "vibracao_pico_z",
    "acel_rms_z",
    "acel_z"
  ];

  return campos.some(campo => {

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

    const filhos = Object.entries(no).filter(
      ([, valor]) =>
        valor !== null &&
        typeof valor === "object" &&
        !Array.isArray(valor)
    );

    // Preserva uma leitura antiga que esteja diretamente
    // na raiz, mesmo que existam registros filhos.
    if (ehRegistro(no)) {
      registros.push({
        ...no,
        _key: caminho || "__registro_raiz__"
      });
    }

    // Continua procurando registros dentro dos filhos.
    filhos.forEach(([chave, valor]) => {
      const novoCaminho = caminho
        ? `${caminho}/${chave}`
        : chave;

      percorrer(valor, novoCaminho);
    });
  }

  percorrer(dados, "");

  const unicos = new Map();

  registros.forEach(registro => {
    unicos.set(registro._key, registro);
  });

  const resultado = [...unicos.values()];

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


// ============================================================================
// 6. STATUS DA CONEXAO
// ============================================================================

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

  }, erro => {

    console.error("[FIREBASE] Erro de conexão:", erro);

  });

}


// ============================================================================
// 7. GRAFICO
// ============================================================================

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
            maxTicksLimit: 12
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