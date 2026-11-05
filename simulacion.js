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

// ===== CONTROLADOR =====
// limita al valor en un rango
// esta es una de las no linealidades del sistema (no baja de 0 ni sube de 100)
function limitar(valor, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, valor));
}

// Calefacción: control PI (válvula mezcladora), con feedforward opcional
function controlCalefaccion(error) {
    const parteProporcional = entrada.kp * error;
    const parteIntegral = entrada.ti > 0 ? estado.integral : 0;   // ti = 0 → sólo P

    // Feedforward: si hay sol, bajamos la calefacción por adelantado
    // en la misma cantidad de calor que va a aportar el sol
    const compensacionSol = entrada.feedforward
        ? (parametros.gananciaSol * entrada.radiacion) / parametros.gananciaCalefaccion
        : 0;

    const ordenSinLimite = parteProporcional + parteIntegral - compensacionSol;
    const orden = limitar(ordenSinLimite, 0, 1);

    // Actualiza la integral, salvo que la válvula ya esté al tope
    if (entrada.ti > 0) {
        const topeArriba = ordenSinLimite >= 1 && error > 0;
        const topeAbajo = ordenSinLimite <= 0 && error < 0;
        if (!topeArriba && !topeAbajo) {
        estado.integral += (entrada.kp / entrada.ti) * error * PASO;
        }
    }
    return orden;
}

// Ventanas: control proporcional con banda
function controlVentanas(medicion) {
    const umbral = entrada.referencia + entrada.offsetVentilacion; // desde aca empiezan a abrir
    let apertura = (medicion - umbral) / entrada.bandaVentanas;    // 0 en el umbral, 1 al final de la banda
    apertura = limitar(apertura, 0, 1);
    if (entrada.lluvia) apertura = Math.min(apertura, 0.1);        // con lluvia, como mucho 10 %
    return apertura;
}

function pasoSimulacion() {
    const p = parametros;

    // --- Elemento de medicion: el sensor sigue a la temperatura real con retardo ---
    estado.tempMedida += PASO * (estado.tempReal - estado.tempMedida) / p.retardoSensor;
    estado.salida = estado.tempMedida + p.ruidoSensor * ruidoGaussiano();

    // --- Controlador: compara la medicion con la referencia y decide ---
    const error = entrada.referencia - estado.salida;          // e = r − y
    const ordenCalefaccion = controlCalefaccion(error);
    const aperturaVentanas = controlVentanas(estado.salida);

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

    estado.tempReal += PASO * velocidadDeCambio; // método de Euler

    // guarda para despues mostrar
    estado.ordenCalefaccion = ordenCalefaccion;
    estado.aperturaVentanas = aperturaVentanas;
    estado.tiempo += PASO;
}

// avanza la simulación
function avanzar(minutos) {
    const cantidadDePasos = Math.round(minutos / PASO);
    for (let i = 0; i < cantidadDePasos; i++) pasoSimulacion();
}

reiniciar();
console.log("Temperatura inicial:", estado.tempReal, "°C");