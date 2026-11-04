/* MÉTODO DE EULER
   El tiempo se divide en pasos cortos (PASO = 0,02 min = 1,2 s) para simular la continuidad.
   En cada paso se calcula:
   temperatura_nueva = temperatura_actual + (velocidad de cambio × PASO)
*/

// ===== PARÁMETROS SUPUESTOS DEL MODELO =====
const parametros = {
  constanteTiempo: 20,       // inercia térmica del sector (min)
  gananciaCalefaccion: 25,   // °C que sube la calefacción al 100 % por encima del exterior
  gananciaSol: 0.02,         // °C que aporta cada W/m² de radiación solar
  perdidaVentanas: 4,        // pérdida extra de calor con las ventanas al 100 %
  perdidaPuerta: 1.5,        // pérdida extra con la puerta abierta
  retardoCalefaccion: 3,     // retardo de cada etapa de la calefacción por tubos (min)
  retardoSensor: 0.5,        // retardo del sensor (min)
  ruidoSensor: 0.03          // desvío estándar del ruido del sensor (°C)
};

const PASO = 0.02;  // paso de integración (min)


// ===== ENTRADAS FIJAS =====
const entrada = {
  referencia: 20,          // valor de referencia (°C)
  tempExterior: 8,         // temperatura exterior (°C)
  radiacion: 150,          // radiación solar (W/m²)
  viento: 3,               // viento (m/s)
  lluvia: false,
  kp: 0.25,                // ganancia proporcional del PI
  ti: 15,                  // tiempo integral del PI (min)
  offsetVentilacion: 2,    // °C por encima de la referencia donde empiezan a abrir las ventanas
  bandaVentanas: 3,        // banda proporcional de las ventanas (°C)
  feedforward: false       // compensación por radiación
};


// ===== ESTADO DEL SISTEMA =====
let estado;

function reiniciar() {
  estado = {
    tiempo: 0,                  // tiempo simulado (min)
    tempReal: 20,               // temperatura real del aire (°C)
    tempMedida: 20,             // temperatura que "ve" el sensor (°C)
    etapa1Calefaccion: 0.4,     // primera etapa de retardo de la calefacción
    potenciaCalefaccion: 0.4,   // calor que llega al aire (0 a 1)
    integral: 0.4,              // parte integral del PI (paso 5)
    ordenCalefaccion: 0.4,      // orden que da el controlador a la calefacción (0 a 1)
    aperturaVentanas: 0,        // apertura de las ventanas (0 a 1)
    salida: 20                  // medición con ruido: la salida del sistema (°C)
  };
}

// numero aleatorio con distribución normal para el ruido del sensor
function ruidoGaussiano() {
  const u = 1 - Math.random(), v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}


function pasoSimulacion() {
  const p = parametros;

  // --- Elemento de medicion: el sensor sigue a la temperatura real con retardo ---
  estado.tempMedida += PASO * (estado.tempReal - estado.tempMedida) / p.retardoSensor;
  estado.salida = estado.tempMedida + p.ruidoSensor * ruidoGaussiano();

  // --- Controlador ---
  const ordenCalefaccion = estado.ordenCalefaccion;
  const aperturaVentanas = estado.aperturaVentanas;

  // --- Actuador de calefacción: dos etapas de retardo (el agua tarda en calentar los tubos) ---
  estado.etapa1Calefaccion += PASO * (ordenCalefaccion - estado.etapa1Calefaccion) / p.retardoCalefaccion;
  estado.potenciaCalefaccion += PASO * (estado.etapa1Calefaccion - estado.potenciaCalefaccion) / p.retardoCalefaccion;

  // --- Planta: balance de calor del aire del sector ---
  const viento = entrada.viento;
  const perdidas = 1 + p.perdidaVentanas * aperturaVentanas * (1 + 0.15 * viento) + 0.03 * viento;
  const calorQueSale = perdidas * (estado.tempReal - entrada.tempExterior);
  const calorCalefaccion = p.gananciaCalefaccion * estado.potenciaCalefaccion;
  const calorSol = p.gananciaSol * entrada.radiacion;
  const velocidadDeCambio = (calorCalefaccion + calorSol - calorQueSale) / p.constanteTiempo;

  estado.tempReal += PASO * velocidadDeCambio;   // método de Euler
  estado.tiempo += PASO;
}

// avanza la simulación
function avanzar(minutos) {
  const cantidadDePasos = Math.round(minutos / PASO);
  for (let i = 0; i < cantidadDePasos; i++) pasoSimulacion();
}

reiniciar();
console.log("Temperatura inicial:", estado.tempReal, "°C");