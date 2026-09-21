
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


const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');

const valSensor1El = document.getElementById('val-sensor1');
const timeSensor1El = document.getElementById('time-sensor1');

const valSensor2El = document.getElementById('val-sensor2');
const timeSensor2El = document.getElementById('time-sensor2');


const ctx = document.getElementById('graficoLeituras').getContext('2d');

const grafico = new Chart(ctx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Sensor 1',
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        borderWidth: 2,
        pointBackgroundColor: '#38bdf8',
        tension: 0.3,
        fill: true,
        data: []
      },
      {
        label: 'Sensor 2',
        borderColor: '#4ade80',
        backgroundColor: 'rgba(74, 222, 128, 0.1)',
        borderWidth: 2,
        pointBackgroundColor: '#4ade80',
        tension: 0.3,
        fill: true,
        data: []
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { family: 'Inter' } }
      }
    },
    scales: {
      x: {
        grid: { color: '#334155' },
        ticks: { color: '#94a3b8', font: { family: 'Inter' } }
      },
      y: {
        grid: { color: '#334155' },
        ticks: { color: '#94a3b8', font: { family: 'Inter' } }
      }
    }
  }
});


const leiturasRef = database.ref('leituras').limitToLast(20);

// Monitora conexão com Firebase
database.ref('.info/connected').on('value', (snap) => {
  if (snap.val() === true) {
    statusBadge.className = 'badge online';
    statusText.innerText = 'Online';
  } else {
    statusBadge.className = 'badge offline';
    statusText.innerText = 'Desconectado';
  }
});

// Atualiza Gráficos e Cards
leiturasRef.on('value', (snapshot) => {
  const data = snapshot.val();
  if (!data) return;

  const rotulos = [];
  const dadosSensor1 = [];
  const dadosSensor2 = [];
  
  let ultimaLeitura = null;

  Object.keys(data).forEach(key => {
    const item = data[key];
    const hora = item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : '';
    
    rotulos.push(hora);
    dadosSensor1.push(item.sensor_1);
    dadosSensor2.push(item.sensor_2);

    ultimaLeitura = item; // O último item percorrido é a leitura mais recente
  });

  // Atualiza Gráfico
  grafico.data.labels = rotulos;
  grafico.data.datasets[0].data = dadosSensor1;
  grafico.data.datasets[1].data = dadosSensor2;
  grafico.update();


  if (ultimaLeitura) {
    const horaFormatada = ultimaLeitura.timestamp ? new Date(ultimaLeitura.timestamp).toLocaleTimeString() : '--:--:--';
    
    valSensor1El.innerText = ultimaLeitura.sensor_1 !== undefined ? ultimaLeitura.sensor_1 : '--';
    timeSensor1El.innerText = horaFormatada;

    valSensor2El.innerText = ultimaLeitura.sensor_2 !== undefined ? ultimaLeitura.sensor_2 : '--';
    timeSensor2El.innerText = horaFormatada;
  }
});

// Este código cria o nó /leituras automaticamente no Firebase
function criarPrimeiroNo() {
  database.ref('leituras').push({
    sensor_1: 25.5,
    sensor_2: 60.0,
    timestamp: firebase.database.ServerValue.TIMESTAMP
  });
}

// Executa uma vez assim que a página abre
criarPrimeiroNo();

// --- SIMULADOR DE TESTE WEB ---
function enviarLeituraSimulada() {
  const leituraFicticia = {
    sensor_1: parseFloat((20 + Math.random() * 15).toFixed(1)), // Simula valor entre 20 e 35
    sensor_2: parseFloat((40 + Math.random() * 40).toFixed(1)), // Simula valor entre 40 e 80
    timestamp: firebase.database.ServerValue.TIMESTAMP
  };

  // Envia diretamente para o nó /leituras
  database.ref('leituras').push(leituraFicticia)
    .then(() => console.log("Dado simulado enviado!"))
    .catch((err) => console.error("Erro ao enviar:", err));
}

// Envia uma nova leitura simulada a cada 3 segundos
setInterval(enviarLeituraSimulada, 3000);