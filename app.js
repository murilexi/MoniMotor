
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


// ============================================================================
// 8. CARDS
// ============================================================================

function atualizarCards(dado) {

  const temperatura = obterTemperatura(dado);
  const rpm = obterRPM(dado);
  const corrente = obterCorrente(dado);
  const vibracao = obterVibracao(dado);

  const hora = formatarHora(dado.timestamp);

  document.getElementById("val-temp").textContent =
    temperatura !== null ? temperatura.toFixed(2) : "--";

  document.getElementById("val-rpm").textContent =
    rpm !== null ? rpm.toLocaleString("pt-BR") : "--";

  document.getElementById("val-corrente").textContent =
    corrente !== null ? corrente.toFixed(2) : "--";

  document.getElementById("val-acel").textContent =
    vibracao !== null ? vibracao.toFixed(3) : "--";

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

    const elemento = document.getElementById(id);

    if (elemento) elemento.textContent = "--";

  });

  [
    "time-temp",
    "time-rpm",
    "time-corrente",
    "time-acel"
  ].forEach(id => {

    const elemento = document.getElementById(id);

    if (elemento) elemento.textContent = "--:--:--";

  });

}


// ============================================================================
// 9. ATUALIZACAO DO GRAFICO
// ============================================================================

function atualizarGrafico(leituras) {

  if (!grafico) return;

  grafico.data.labels = leituras.map(
    dado => formatarHora(dado.timestamp)
  );

  grafico.data.datasets[0].data =
    leituras.map(obterTemperatura);

  grafico.data.datasets[1].data =
    leituras.map(obterRPM);

  grafico.data.datasets[2].data =
    leituras.map(obterCorrente);

  grafico.data.datasets[3].data =
    leituras.map(obterVibracao);

  grafico.update("none");

  console.log(
    "[GRÁFICO] Atualizado:",
    leituras.length,
    "amostras."
  );

}


// ============================================================================
// 10. HISTORICO
// ============================================================================

function renderizarHistorico(leituras) {

  const corpo = document.getElementById("history-body");

  const contador = document.getElementById("history-count");

  if (!corpo || !contador) return;

  corpo.replaceChildren();

  if (leituras.length === 0) {

    const linha = document.createElement("tr");
    const celula = document.createElement("td");

    celula.colSpan = 5;
    celula.className = "history-empty";
    celula.textContent = "Aguardando primeiras leituras...";

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
        : "--"

    ];


    valores.forEach(valor => {

      const celula = document.createElement("td");

      celula.textContent = valor;

      linha.appendChild(celula);

    });

    corpo.appendChild(linha);

  });


  contador.textContent =
    `${recentes.length} últimas leituras`;

}


// ============================================================================
// 11. ESTADO DO MOTOR
// ============================================================================

function identificarEstadoMotor(dado) {

  const rpm = obterRPM(dado);
  const corrente = obterCorrente(dado);

  if (rpm === null || corrente === null) {
    return "indeterminado";
  }

  const rotacaoAtiva = rpm > CONFIG.rpmMinimoOperacao;

  const correnteAtiva =
    corrente > CONFIG.correnteMinimaOperacao;

  if (!rotacaoAtiva && !correnteAtiva) return "parado";

  if (rotacaoAtiva && correnteAtiva) return "operando";

  if (!rotacaoAtiva && correnteAtiva) {
    return "corrente_sem_rotacao";
  }

  return "inconsistente";

}


// ============================================================================
// 12. REFERENCIA OPERACIONAL
// ============================================================================

function capturarReferencia(leituras) {

  if (leituras.length === 0) return null;

  if (referenciaOperacional !== null) {
    return referenciaOperacional;
  }

  const atual = leituras[leituras.length - 1];

  const amostrasValidas = leituras.filter(dado => {

    const mesmaSessao = demonstracaoAtiva
      ? dado.sessao_teste === sessaoDemonstracao
      : dado.modo !== "simulacao";

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


  if (amostrasValidas.length < CONFIG.amostrasReferencia) {

    console.log(
      "[REFERÊNCIA]",
      amostrasValidas.length,
      "/",
      CONFIG.amostrasReferencia
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
    "[ANÁLISE] Referência operacional estabelecida:",
    referenciaOperacional
  );


  return referenciaOperacional;

}


// ============================================================================
// 13. ANALISE DE MANUTENCAO
// ============================================================================

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


  // FALHAS DE SENSORES

  if (atual.sensor_ds18b20_ok === false) {

    adicionar(
      "warning",
      "FALHA NO SENSOR DE TEMPERATURA",
      "DS18B20",
      "Não foi recebida uma temperatura válida.",
      "Verificar alimentação, cabeamento, resistor de pull-up e conexão DATA."
    );

  }

  if (atual.sensor_mpu6050_ok === false) {

    adicionar(
      "warning",
      "FALHA DE COMUNICAÇÃO COM MPU6050",
      "MPU6050",
      "Não foi possível obter a aceleração.",
      "Verificar alimentação, SDA, SCL e endereço I2C."
    );

  }

  if (atual.sensor_acs712_ok === false) {

    adicionar(
      "warning",
      "FALHA DE LEITURA DE CORRENTE",
      "ACS712",
      "A leitura analógica foi considerada inválida.",
      "Verificar alimentação, divisor de tensão, aterramento e calibração."
    );

  }

  if (atual.sensor_hall_ok === false) {

    adicionar(
      "warning",
      "FALHA NO SENSOR HALL",
      "Sensor Hall",
      "A contagem de pulsos está indisponível.",
      "Verificar alimentação, saída digital, ímã e conexão ao ESP32."
    );

  }


  // REFERENCIA

  const referencia = capturarReferencia(leituras);

  if (referencia === null) {

    adicionar(
      "ok",
      "COLETANDO REFERÊNCIA OPERACIONAL",
      "Todos os sensores",
      "São necessárias dez leituras completas em operação normal.",
      "Manter condições estáveis durante a coleta da referência."
    );

    return {
      diagnosticos,
      nivelMaximo,
      referencia: null
    };

  }


  // TEMPERATURA

  const temperaturaAlta = persistenciaConfirmada(
    leituras,
    obterTemperatura,
    valor =>
      valor >= referencia.temperatura +
      CONFIG.aumentoTemperatura
  );


  // CORRENTE

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


  // RPM

  const rpmBaixo = persistenciaConfirmada(
    leituras,
    obterRPM,
    valor =>
      valor <= referencia.rpm *
      (1 - CONFIG.quedaRPMPercentual)
  );


  // VIBRACAO

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


  // CORRENTE + RPM

  if (correnteAlta && rpmBaixo) {

    adicionar(
      "warning",
      "AUMENTO DE CARGA COM REDUÇÃO DE ROTAÇÃO",
      "ACS712 + Hall",
      "A corrente RMS aumentou enquanto a rotação caiu persistentemente. Pode haver aumento de carga, atrito mecânico ou alteração no acionamento.",
      "Verificar corrente nominal, alimentação, carga acionada, acoplamento e rolamentos. Confirmar RPM com tacômetro independente."
    );

  } else {

    if (correnteAlta) {

      adicionar(
        "warning",
        "AUMENTO PERSISTENTE DE CORRENTE",
        "ACS712",
        "A corrente RMS permaneceu acima da referência operacional.",
        "Comparar com a corrente nominal da placa do motor e um alicate amperímetro. Investigar carga, tensão, conexões e acionamento."
      );

    }

    if (rpmBaixo) {

      adicionar(
        "warning",
        "REDUÇÃO PERSISTENTE DE ROTAÇÃO",
        "Sensor Hall",
        "A rotação permaneceu abaixo da referência operacional.",
        "Verificar carga mecânica, acionamento, posição do ímã e contagem de pulsos."
      );

    }

  }


  // TEMPERATURA

  if (temperaturaAlta) {

    adicionar(
      "warning",
      "ELEVAÇÃO PERSISTENTE DE TEMPERATURA",
      "DS18B20",
      "A temperatura permaneceu pelo menos 4 °C acima da referência.",
      "Inspecionar ventilação, fluxo de ar, aletas, carga e fixação do sensor. Comparar com o limite térmico do fabricante."
    );

  }


  // TEMPERATURA + CORRENTE

  if (temperaturaAlta && correnteAlta) {

    adicionar(
      "warning",
      "AQUECIMENTO ASSOCIADO AO AUMENTO DE CORRENTE",
      "DS18B20 + ACS712",
      "Temperatura e corrente RMS aumentaram simultaneamente.",
      "Verificar carga, ventilação, conexões elétricas e rolamentos. Confirmar as medições antes de concluir que há sobrecarga."
    );

  }


  // VIBRACAO

  if (vibracaoAlta) {

    adicionar(
      "warning",
      "AUMENTO PERSISTENTE DE ACELERAÇÃO",
      "MPU6050",
      "A aceleração RMS dinâmica no eixo Z ultrapassou a referência.",
      "Verificar fixação do sensor, base, acoplamento e rolamentos. Complementar com análise dos três eixos e frequência."
    );

  }


  // INSTABILIDADE

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
        "Sensor Hall",
        "A rotação apresentou variação relativa elevada nas últimas cinco leituras.",
        "Investigar variação de carga, acionamento, alimentação e qualidade da contagem dos pulsos."
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
        "A corrente RMS apresentou variação relativa elevada nas últimas cinco leituras.",
        "Verificar carga, alimentação elétrica, conexões e estabilidade do acionamento."
      );

    }

  }


  // NORMALIDADE

  if (diagnosticos.length === 0) {

    adicionar(
      "ok",
      "SEM DESVIOS PERSISTENTES IDENTIFICADOS",
      "Todos os sensores",
      "Os parâmetros monitorados permaneceram próximos da referência operacional.",
      "Manter acompanhamento periódico e registrar as condições normais de operação."
    );

  }


  return {
    diagnosticos,
    nivelMaximo,
    referencia
  };

}


// ============================================================================
// 14. PAINEL DE DIAGNOSTICO
// ============================================================================

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


// ============================================================================
// 15. ESTADO SEM DADOS
// ============================================================================

function mostrarSemDados(mensagem) {

  const badge = document.getElementById("health-badge");

  const texto = document.getElementById("health-text");

  const contador = document.getElementById("diagnostic-count");

  const container = document.getElementById("diagnostic-container");


  if (badge) badge.className = "badge health-unknown";

  if (texto) texto.textContent = mensagem;

  if (contador) contador.textContent = "Sem medições recentes";


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
      "Não há leituras recentes suficientes para avaliar o motor.";


    const acao = document.createElement("div");

    acao.className = "diag-action";

    acao.textContent =
      "Verificar ESP32, conexão e disponibilidade dos sensores.";


    card.append(titulo, descricao, acao);

    container.appendChild(card);

  }

}


// ============================================================================
// 16. PROCESSAMENTO DO DASHBOARD
// ============================================================================

function processarLeituras(leituras) {

  if (!Array.isArray(leituras) || leituras.length === 0) {

    limparCards();

    atualizarGrafico([]);

    renderizarHistorico([]);

    mostrarSemDados("Aguardando leituras");

    return;

  }


  const atual = leituras[leituras.length - 1];


  atualizarCards(atual);

  atualizarGrafico(leituras);

  renderizarHistorico(leituras);


  const resultado = analisarSaudeDoMotor(leituras);

  const estado = identificarEstadoMotor(atual);

  const diagnosticos = [...resultado.diagnosticos];

  let nivel = resultado.nivelMaximo;

  let mensagem = "";


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

    if (nivel === "ok") nivel = "unknown";

  } else if (estado === "corrente_sem_rotacao") {

    mensagem = "Corrente presente sem rotação";

    nivel = "warning";

    diagnosticos.unshift({

      nivel: "warning",

      titulo: "VERIFICAR POSSÍVEL BLOQUEIO OU FALHA DE ROTAÇÃO",

      sensores: "ACS712 + Hall",

      causa: "Foi detectada corrente, mas a rotação está abaixo do limite operacional.",

      acao: "Verificar alimentação, acionamento, carga mecânica e funcionamento do sensor Hall."

    });

  } else {

    mensagem = "Estado operacional indeterminado";

  }


  if (!leituraCompleta(atual)) {

    diagnosticos.unshift({

      nivel: "warning",

      titulo: "TELEMETRIA INCOMPLETA",

      sensores: "Um ou mais canais",

      causa: "Nem todos os parâmetros necessários foram recebidos.",

      acao: "Verificar sensores, alimentação, fiação e comunicação."

    });

    if (nivel === "ok") nivel = "warning";

  }


  atualizarPainelDiagnostico(
    diagnosticos,
    nivel,
    mensagem
  );


  console.log("[DASHBOARD] Última leitura:", atual);

  console.log("[ANÁLISE] Estado:", estado);

  console.log("[ANÁLISE] Referência:", referenciaOperacional);

  console.log("[ANÁLISE] Relatórios:", diagnosticos);

}


// ============================================================================
// 17. TROCA DA FONTE DE DADOS
// ============================================================================

function desconectarConsulta() {

  if (consultaAtiva && callbackConsulta) {

    consultaAtiva.off("value", callbackConsulta);

  }

  consultaAtiva = null;

  callbackConsulta = null;

}


function conectarFonteDados(caminho) {

  desconectarConsulta();

  caminhoAtual = caminho;

  ultimoRecebimento = null;

  alertaTimeoutExibido = false;

  referenciaOperacional = null;

  identificadorReferencia = null;


  console.log("[FONTE] Conectando ao caminho:", caminho);


  consultaAtiva = database
    .ref(caminho)
    .orderByKey()
    .limitToLast(CONFIG.quantidadeAmostras);


  callbackConsulta = snapshot => {

    const leituras = obterLeituras(snapshot);

    console.log(
      "[FIREBASE] Registros recebidos:",
      snapshot.numChildren()
    );

    console.log(
      "[FIREBASE] Leituras interpretadas:",
      leituras.length
    );


    ultimoRecebimento = Date.now();

    alertaTimeoutExibido = false;


    processarLeituras(leituras);

  };


  consultaAtiva.on("value", callbackConsulta, erro => {

    console.error("[FIREBASE] Erro de leitura:", erro);

    mostrarSemDados("Erro ao receber dados");

  });

}


// ============================================================================
// 18. DEMONSTRAÇÃO: GERAÇÃO DE DADOS
// ============================================================================

function gerarDadosDemonstracao() {

  const tempo =
    (Date.now() - inicioDemonstracao) / 1000;


  // Valores normais do cenário de motor elétrico.
  // Quatro polos, frequência de referência de 60 Hz.

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


  // ANOMALIA DE TEMPERATURA

  if (anomalias.temperatura) {

    temperatura =
      53.0 +
      0.20 * Math.sin(tempo * 0.10);

  }


  // ANOMALIA DE RPM

  if (anomalias.rpm) {

    rpm =
      1450 +
      4 * Math.sin(tempo * 0.25);

  }


  // ANOMALIA DE CORRENTE

  if (anomalias.corrente) {

    corrente =
      13.2 +
      0.10 * Math.sin(tempo * 0.50);

  }


  // ANOMALIA DE VIBRAÇÃO

  if (anomalias.vibracao) {

    vibracaoRMS =
      1.75 +
      0.04 * Math.sin(tempo * 0.70);

  }


  const vibracaoPico =
    vibracaoRMS * 1.65 +
    0.04 * Math.abs(Math.sin(tempo * 1.10));


  // Um ímã, um pulso por volta.

  const pulsosHall = Math.round(
    rpm * CONFIG.intervaloSimulacao / 60000
  );


  const anomaliasAtivas = Object.keys(anomalias)
    .filter(tipo => anomalias[tipo]);


  return {

    temperatura: Number(temperatura.toFixed(2)),

    rpm: Math.round(rpm),

    corrente: Number(corrente.toFixed(3)),

    vibracao_rms_z: Number(vibracaoRMS.toFixed(3)),

    vibracao_pico_z: Number(vibracaoPico.toFixed(3)),

    pulsos_hall: pulsosHall,

    timestamp: firebase.database.ServerValue.TIMESTAMP,

    modo: "simulacao",

    sessao_teste: sessaoDemonstracao,

    anomalias_ativas: anomaliasAtivas,

    corrente_tipo: "AC_RMS",

    sensor_ds18b20_ok: true,

    sensor_mpu6050_ok: true,

    sensor_acs712_ok: true,

    sensor_hall_ok: true

  };

}


// ============================================================================
// 19. ENVIO DAS AMOSTRAS DE DEMONSTRAÇÃO
// ============================================================================

async function enviarDadosDemonstracao() {

  if (
    !demonstracaoAtiva ||
    enviandoDemonstracao
  ) {
    return;
  }

  enviandoDemonstracao = true;


  try {

    contadorDemonstracao++;

    const dados = gerarDadosDemonstracao();


    // Dados demonstrativos nunca são gravados em /leituras.

    const novaReferencia = database
      .ref("leituras_teste")
      .push();


    await novaReferencia.set(dados);


    console.log(
      "[DEMONSTRAÇÃO] Amostra:",
      contadorDemonstracao
    );

    console.log(
      "[DEMONSTRAÇÃO] ID:",
      novaReferencia.key
    );


  } catch (erro) {

    console.error(
      "[DEMONSTRAÇÃO] Erro ao gravar:",
      erro
    );

  } finally {

    enviandoDemonstracao = false;

  }

}


// ============================================================================
// 20. INICIAR DEMONSTRAÇÃO
// ============================================================================

function iniciarDemonstracao() {

  if (demonstracaoAtiva) return;

  demonstracaoAtiva = true;

  // Uma nova sessão só é criada no primeiro início. Ao retomar após pausa,
  // preservamos a referência e o estado dos atalhos para não reiniciar a análise.
  if (!sessaoDemonstracao) {

    inicioDemonstracao = Date.now();
    contadorDemonstracao = 0;

    sessaoDemonstracao =
      "demo_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8);

    Object.keys(anomalias).forEach(tipo => {
      anomalias[tipo] = false;
    });

    // A demonstração usa um nó independente e nunca mistura dados físicos.
    conectarFonteDados("leituras_teste");

  } else if (caminhoAtual !== "leituras_teste") {

    conectarFonteDados("leituras_teste");

  }

  // Primeira amostra imediatamente; demais respeitam o intervalo configurado.
  enviarDadosDemonstracao();

  intervaloDemonstracao = setInterval(
    enviarDadosDemonstracao,
    CONFIG.intervaloSimulacao
  );

  console.log("[DEMONSTRAÇÃO] Envio iniciado/retomado:", sessaoDemonstracao);

}


// Pausar mantém a sessão, a referência, os alertas e o último gráfico na tela.
// A próxima barra de espaço retoma a mesma sessão sem reiniciar a linha de base.
function pausarDemonstracao() {

  if (!demonstracaoAtiva) return;

  demonstracaoAtiva = false;

  if (intervaloDemonstracao !== null) {
    clearInterval(intervaloDemonstracao);
    intervaloDemonstracao = null;
  }

  console.log("[DEMONSTRAÇÃO] Pausada. Os dados e o relatório permanecem na tela.");

}


// Sair da demonstração e voltar a acompanhar o caminho dos sensores físicos.
function encerrarDemonstracao() {

  if (!demonstracaoAtiva && !sessaoDemonstracao && caminhoAtual === "leituras") return;

  demonstracaoAtiva = false;

  if (intervaloDemonstracao !== null) {
    clearInterval(intervaloDemonstracao);
    intervaloDemonstracao = null;
  }

  Object.keys(anomalias).forEach(tipo => {
    anomalias[tipo] = false;
  });

  sessaoDemonstracao = null;
  referenciaOperacional = null;
  identificadorReferencia = null;

  conectarFonteDados("leituras");

  console.log("[DEMONSTRAÇÃO] Encerrada. Monitoramento físico retomado.");

}


// ============================================================================
// 22. ALTERAR ANOMALIAS
// ============================================================================

function alternarAnomalia(tipo) {

  if (!demonstracaoAtiva) {

    console.warn(
      "[TESTE] Inicie a demonstração primeiro."
    );

    return;

  }


  if (!referenciaOperacional) {

    console.warn(
      "[TESTE] Aguarde dez leituras normais."
    );

    return;

  }


  if (!Object.prototype.hasOwnProperty.call(anomalias, tipo)) {
    return;
  }


  anomalias[tipo] = !anomalias[tipo];


  console.log(
    "[TESTE] Estado das anomalias:",
    { ...anomalias }
  );


  console.log(
    "[TESTE] A alteração será enviada na próxima amostra."
  );

}


function restaurarAnomalias() {

  if (!demonstracaoAtiva) return;


  Object.keys(anomalias).forEach(tipo => {

    anomalias[tipo] = false;

  });


  console.log("[TESTE] Condição normal restaurada.");

}


// ============================================================================
// 23. ATALHOS OCULTOS DE TECLADO
// ============================================================================
// ESPAÇO: iniciar / pausar / retomar a demonstração.
// ALT + SHIFT + 1: anomalia de temperatura.
// ALT + SHIFT + 2: anomalia de rotação (RPM).
// ALT + SHIFT + 3: anomalia de corrente.
// ALT + SHIFT + 4: anomalia de vibração.
// ALT + SHIFT + 0: restaurar os quatro sensores à condição normal.
// ALT + SHIFT + M: sair da demonstração e voltar à fonte física /leituras.
// Nenhum controle ou aviso de simulação é criado na interface.

document.addEventListener("keydown", event => {

  if (event.repeat) return;

  const elemento = event.target;

  // Não captura atalhos enquanto o usuário digita em campos editáveis.
  if (
    elemento &&
    elemento.closest &&
    elemento.closest("input, textarea, select, button, [contenteditable='true']")
  ) {
    return;
  }

  if (event.ctrlKey || event.metaKey) return;

  // Barra de espaço inicia, pausa ou retoma. Impede também a rolagem da página.
  if (event.code === "Space" && !event.altKey && !event.shiftKey) {
    event.preventDefault();

    if (demonstracaoAtiva) {
      pausarDemonstracao();
    } else {
      iniciarDemonstracao();
    }

    return;
  }

  // Atalhos discretos para controle dos valores sdos.
  if (!event.altKey || !event.shiftKey) return;

  const tecla = event.key.toLowerCase();

  // ALT + SHIFT + M encerra a sessão e volta à fonte física.
  if (tecla === "m") {
    event.preventDefault();
    encerrarDemonstracao();
    return;
  }

  if (!demonstracaoAtiva) return;

  const mapaAnomalias = {
    "1": "temperatura",
    "2": "rpm",
    "3": "corrente",
    "4": "vibracao"
  };

  if (Object.prototype.hasOwnProperty.call(mapaAnomalias, tecla)) {
    event.preventDefault();
    alternarAnomalia(mapaAnomalias[tecla]);
    return;
  }

  if (tecla === "0") {
    event.preventDefault();
    restaurarAnomalias();
  }

});


// ============================================================================
// 24. MONITOR DE INTERRUPÇÃO
// ============================================================================

setInterval(() => {

  if (ultimoRecebimento === null) return;


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

  }

}, 2000);


// ============================================================================
// 25. INICIALIZAÇÃO
// ============================================================================

function iniciarMoniMotor() {

  console.log("MONIMOTOR INICIADO.");

  inicializarGrafico();

  monitorarStatusConexao();

  // Começa acompanhando os dados físicos.

  conectarFonteDados("leituras");

}


iniciarMoniMotor();

