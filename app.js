/* ==========================================================================
   MONIMOTOR
   Firebase Realtime Database + dados simulados + Chart.js
   Os dados simulados são gravados em /leituras e o dashboard os lê do Firebase.
   ========================================================================== */

// Mantenha estes dados do aplicativo Firebase Web já cadastrado no projeto.
// A API Key do Firebase identifica o projeto; não é uma senha de banco.
const firebaseConfig = {
  apiKey: "AIzaSyDgv8TKtlN8cZaNhcrFtC9j1HM4gXUu06c",
  authDomain: "upx2---projeto.firebaseapp.com",
  databaseURL: "https://upx2---projeto-default-rtdb.firebaseio.com/",
  projectId: "upx2---projeto",
  storageBucket: "upx2---projeto.firebasestorage.app",
  messagingSenderId: "320149787397",
  appId: "1:320149787397:web:28b5b4fc62c85399079d6c"
};

const CONFIG = {
  caminho: "leituras",
  amostrasGrafico: 20,
  intervaloSimulacao: 3000,
  timeoutMs: 12000
};

const el = {
  status: document.getElementById("status-text"),
  statusBadge: document.getElementById("status-badge"),
  health: document.getElementById("health-text"),
  healthBadge: document.getElementById("health-badge"),
  diagnosticCount: document.getElementById("diagnostic-count"),
  diagnosticContainer: document.getElementById("diagnostic-container"),
  dataMode: document.getElementById("data-mode")
};

let db = null;
let chart = null;
let timerSimulacao = null;
let ultimaRecepcao = 0;
let conectado = false;
let enviando = false;
let inicioSimulacao = Date.now();
let numeroAmostra = 0;
let leituras = [];

// --------------------------------------------------------------------------
// Utilitários
// --------------------------------------------------------------------------

function numero(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function valorDe(leitura, campo) {
  if (!leitura) return null;
  if (campo === "vibracao_pico_z") {
    return numero(leitura.vibracao_pico_z ?? leitura.vibracao_rms_z ?? leitura.acel_z);
  }
  return numero(leitura[campo]);
}

function hora(timestamp) {
  const n = numero(timestamp);
  if (n === null) return "--:--:--";
  const ms = n > 1000000000000 ? n : n > 1000000000 ? n * 1000 : null;
  return ms === null ? "--:--:--" : new Date(ms).toLocaleTimeString("pt-BR");
}

function fmt(valor, casas = 2) {
  return Number(valor).toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas
  });
}

function mediana(valores) {
  if (!valores.length) return 0;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

function definirStatusSaude(classe, texto) {
  el.healthBadge.className = `badge ${classe}`;
  el.health.textContent = texto;
}

function mostrarDiagnostico(nivel, titulo, descricao, acao = "") {
  const card = document.createElement("article");
  card.className = `diag-card ${nivel}`;

  const h = document.createElement("div");
  h.className = "diag-title";
  h.textContent = titulo;

  const p = document.createElement("div");
  p.className = "diag-desc";
  p.textContent = descricao;

  card.append(h, p);

  if (acao) {
    const a = document.createElement("div");
    a.className = "diag-action";
    a.textContent = acao;
    card.append(a);
  }
  el.diagnosticContainer.replaceChildren(card);
}

// --------------------------------------------------------------------------
// Gráfico
// --------------------------------------------------------------------------

function iniciarGrafico() {
  const canvas = document.getElementById("graficoLeituras");
  if (!canvas || typeof Chart === "undefined") {
    throw new Error("Chart.js não foi carregado. Verifique a conexão com a internet.");
  }

  chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "Temperatura (°C)",
          data: [],
          yAxisID: "yTemp",
          borderColor: "#29a8ff",
          backgroundColor: "rgba(41,168,255,.12)",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: .28
        },
        {
          label: "Rotação (RPM)",
          data: [],
          yAxisID: "yRpm",
          borderColor: "#19d58b",
          backgroundColor: "rgba(25,213,139,.10)",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: .28
        },
        {
          label: "Corrente (A)",
          data: [],
          yAxisID: "yCorrente",
          borderColor: "#ffbd4a",
          backgroundColor: "rgba(255,189,74,.10)",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: .28
        },
        {
          label: "Vibração (m/s²)",
          data: [],
          yAxisID: "yVibracao",
          borderColor: "#ff5d65",
          backgroundColor: "rgba(255,93,101,.10)",
          borderWidth: 2,
          pointRadius: 2,
          pointHoverRadius: 4,
          tension: .28
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 250 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#c6d0d7",
            usePointStyle: true,
            pointStyle: "line",
            padding: 18,
            font: { family: "Plus Jakarta Sans", size: 11 }
          }
        },
        tooltip: {
          backgroundColor: "#111820",
          borderColor: "#34414b",
          borderWidth: 1,
          titleColor: "#fff",
          bodyColor: "#dce4e9"
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(137,148,157,.10)" },
          ticks: { color: "#89949d", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
        },
        yRpm: {
          type: "linear", position: "left",
          title: { display: true, text: "RPM", color: "#19d58b" },
          grid: { color: "rgba(137,148,157,.10)" },
          ticks: { color: "#19d58b" }
        },
        yTemp: {
          type: "linear", position: "right", display: false,
          grid: { drawOnChartArea: false }
        },
        yCorrente: {
          type: "linear", position: "right", display: false,
          grid: { drawOnChartArea: false }
        },
        yVibracao: {
          type: "linear", position: "right", display: false,
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

function atualizarGrafico(lista) {
  if (!chart) return;
  chart.data.labels = lista.map(item => hora(item.timestamp));
  chart.data.datasets[0].data = lista.map(item => valorDe(item, "temperatura"));
  chart.data.datasets[1].data = lista.map(item => valorDe(item, "rpm"));
  chart.data.datasets[2].data = lista.map(item => valorDe(item, "corrente"));
  chart.data.datasets[3].data = lista.map(item => valorDe(item, "vibracao_pico_z"));
  chart.update();
}

// --------------------------------------------------------------------------
// Cards e análise
// --------------------------------------------------------------------------

function atualizarCards(leitura) {
  const campos = [
    ["val-temp", "time-temp", "temperatura", 2],
    ["val-rpm", "time-rpm", "rpm", 0],
    ["val-corrente", "time-corrente", "corrente", 2],
    ["val-acel", "time-acel", "vibracao_pico_z", 2]
  ];

  campos.forEach(([valorId, horaId, campo, casas]) => {
    const v = valorDe(leitura, campo);
    document.getElementById(valorId).textContent =
      v === null ? "--" : fmt(v, casas);
    document.getElementById(horaId).textContent = hora(leitura.timestamp);
  });
}

function analisar(lista) {
  if (lista.length < 9) {
    definirStatusSaude("health-unknown", "Coletando linha de base");
    el.diagnosticCount.textContent = `${lista.length}/9 amostras`;
    mostrarDiagnostico(
      "ok",
      "Coletando linha de base",
      `O sistema recebeu ${lista.length} amostra(s). São necessárias pelo menos 9 para iniciar a comparação estatística.`,
      "A coleta simulada continua automaticamente a cada 3 segundos."
    );
    return;
  }

  const atual = lista[lista.length - 1];
  const anteriores = lista.slice(0, -1);
  const regras = [
    { campo: "temperatura", nome: "Temperatura", unidade: "°C", percentual: .10, minimo: 3, direcao: "alta" },
    { campo: "rpm", nome: "Rotação", unidade: "RPM", percentual: .15, minimo: 150, direcao: "ambas" },
    { campo: "corrente", nome: "Corrente", unidade: "A", percentual: .20, minimo: .75, direcao: "alta" },
    { campo: "vibracao_pico_z", nome: "Vibração", unidade: "m/s²", percentual: .25, minimo: .35, direcao: "alta" }
  ];

  const alertas = [];
  regras.forEach(regra => {
    const valorAtual = valorDe(atual, regra.campo);
    const historico = anteriores.map(item => valorDe(item, regra.campo)).filter(v => v !== null);
    if (valorAtual === null || historico.length < 8) return;

    const referencia = mediana(historico.slice(-19));
    const diferenca = valorAtual - referencia;
    const limite = Math.max(Math.abs(referencia) * regra.percentual, regra.minimo);
    const fora = regra.direcao === "alta"
      ? diferenca > limite
      : Math.abs(diferenca) > limite;

    if (fora) {
      alertas.push({
        nome: regra.nome,
        nivel: Math.abs(diferenca) > limite * 1.8 ? "danger" : "warning",
        atual: valorAtual,
        referencia,
        diferenca,
        unidade: regra.unidade
      });
    }
  });

  el.diagnosticCount.textContent = `${alertas.length} alerta(s) / ${lista.length} amostras`;

  if (!alertas.length) {
    definirStatusSaude("health-ok", "Operação simulada estável");
    mostrarDiagnostico(
      "ok",
      "Nenhum desvio estatístico detectado",
      "As leituras recentes permanecem dentro dos limites de variação configurados para esta simulação.",
      "Os limites são parâmetros de demonstração, não limites certificados de fabricante."
    );
    return;
  }

  const grave = alertas.some(a => a.nivel === "danger");
  definirStatusSaude(grave ? "health-danger" : "health-warning",
    grave ? "Desvio acentuado detectado" : "Atenção: variação detectada");

  const primeiro = alertas[0];
  mostrarDiagnostico(
    primeiro.nivel,
    `Desvio detectado: ${primeiro.nome}`,
    `Leitura atual de ${fmt(primeiro.atual)} ${primeiro.unidade}; referência recente de ${fmt(primeiro.referencia)} ${primeiro.unidade}.`,
    "Como os dados são simulados, este alerta serve apenas para testar a apresentação do Centro de Análise."
  );
}

function processarLeituras(lista) {
  leituras = lista.slice(-CONFIG.amostrasGrafico);
  if (!leituras.length) return;

  const ultima = leituras[leituras.length - 1];
  atualizarCards(ultima);
  atualizarGrafico(leituras);
  analisar(leituras);
  el.dataMode.textContent = `DADOS SIMULADOS • ${leituras.length} amostras`;
}

// --------------------------------------------------------------------------
// Simulador: gera e GRAVA no Firebase. O gráfico não usa dados locais.
// --------------------------------------------------------------------------

function gerarLeituraSimulada() {
  const t = (Date.now() - inicioSimulacao) / 1000;
  numeroAmostra++;

  // Variações pequenas para produzir curvas naturais no gráfico.
  const temperatura = 46 + 0.65 * Math.sin(t * .16) + 0.18 * Math.sin(t * .53);
  const rpm = 1750 + 13 * Math.sin(t * .21) + 4 * Math.sin(t * .73);
  const corrente = 8.4 + 0.22 * Math.sin(t * .17) + 0.07 * Math.sin(t * .61);
  const vibracao = 1.05 + 0.08 * Math.sin(t * .48) + 0.025 * Math.sin(t * 1.13);

  return {
    temperatura: Number(temperatura.toFixed(2)),
    rpm: Math.round(rpm),
    corrente: Number(corrente.toFixed(2)),
    vibracao_pico_z: Number(vibracao.toFixed(3)),
    vibracao_rms_z: Number((vibracao / 1.65).toFixed(3)),
    timestamp: firebase.database.ServerValue.TIMESTAMP,
    origem: "simulacao",
    modo: "simulacao",
    amostra: numeroAmostra,
    sensores_simulados: true
  };
}

async function enviarLeituraSimulada() {
  if (!conectado || enviando) return;
  enviando = true;

  try {
    const dados = gerarLeituraSimulada();
    await db.ref(CONFIG.caminho).push(dados);
    console.info(`[SIMULAÇÃO] Amostra ${numeroAmostra} enviada ao Firebase.`);
  } catch (erro) {
    console.error("[SIMULAÇÃO] Falha ao gravar no Firebase:", erro);
    el.status.textContent = "Falha ao gravar dados";
    el.statusBadge.className = "badge offline";
  } finally {
    enviando = false;
  }
}

function iniciarSimulacao() {
  if (timerSimulacao !== null) return;
  inicioSimulacao = Date.now();
  enviarLeituraSimulada();
  timerSimulacao = setInterval(enviarLeituraSimulada, CONFIG.intervaloSimulacao);
  console.info("[SIMULAÇÃO] Envio automático iniciado em /leituras.");
}

function pararSimulacao() {
  if (timerSimulacao !== null) clearInterval(timerSimulacao);
  timerSimulacao = null;
}

// --------------------------------------------------------------------------
// Firebase
// --------------------------------------------------------------------------

function iniciarFirebase() {
  if (typeof firebase === "undefined") {
    throw new Error("Firebase SDK não carregou. Confira a internet e os scripts do HTML.");
  }

  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes("SUA_")) {
    throw new Error("Preencha apiKey e appId no objeto firebaseConfig com os dados do seu app Web Firebase.");
  }

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  db = firebase.database();

  db.ref(".info/connected").on("value", snapshot => {
    conectado = snapshot.val() === true;
    el.status.textContent = conectado ? "Firebase Online" : "Firebase Desconectado";
    el.statusBadge.className = conectado ? "badge online" : "badge offline";

    if (conectado) {
      definirStatusSaude("health-unknown", "Conectado; iniciando dados simulados");
      iniciarSimulacao();
    } else {
      pararSimulacao();
      definirStatusSaude("health-unknown", "Aguardando conexão com Firebase");
    }
  }, erro => {
    console.error("[FIREBASE] Falha ao monitorar conexão:", erro);
  });

  db.ref(CONFIG.caminho)
    .orderByKey()
    .limitToLast(CONFIG.amostrasGrafico)
    .on("value", snapshot => {
      ultimaRecepcao = Date.now();
      const lista = [];
      snapshot.forEach(child => {
        const dado = child.val();
        if (dado && typeof dado === "object" && (
          "temperatura" in dado || "rpm" in dado || "corrente" in dado
        )) {
          lista.push(dado);
        }
      });

      lista.sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0));
      processarLeituras(lista);
    }, erro => {
      console.error("[FIREBASE] Erro ao ler /leituras:", erro);
      mostrarDiagnostico(
        "danger",
        "Erro ao ler o Firebase",
        erro.message || "Não foi possível ler o caminho /leituras.",
        "Confira a URL do Realtime Database e as regras de leitura e gravação."
      );
    });
}

// --------------------------------------------------------------------------
// Inicialização e monitoramento
// --------------------------------------------------------------------------

function inicializar() {
  iniciarGrafico();
  iniciarFirebase();
  console.info("MoniMotor inicializado.");
}

try {
  inicializar();
} catch (erro) {
  console.error("[MONIMOTOR] Erro na inicialização:", erro);
  el.status.textContent = "Falha na inicialização";
  el.statusBadge.className = "badge offline";
  definirStatusSaude("health-danger", "Falha ao iniciar dashboard");
  mostrarDiagnostico("danger", "Falha na inicialização", erro.message);
}
